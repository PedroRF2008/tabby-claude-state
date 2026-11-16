import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService, NotificationsService, ProfilesService } from 'tabby-core'
import { CcmService, DistroCcm } from './ccm.service'
import { CcmProfile, shellId } from './claudeLaunch'
import { DEFAULT_COLORS } from './config'
import { HookInstallerService, HookStatus, HookTarget, PLUGIN_VERSION } from './hookInstaller.service'
import { ClaudeState } from './middleware'
import { ClaudeNotifierService } from './notifier.service'

interface TargetRow {
    target: HookTarget
    status: HookStatus | null
    busy: boolean
    log: string
}

const STATE_LABELS: Record<string, { label: string, description: string }> = {
    working: { label: 'Working', description: 'Claude is thinking or running tools' },
    waiting: { label: 'Needs you', description: 'Permission prompt, question or plan approval' },
    done: { label: 'Done', description: 'Turn finished; clears after you look at the tab' },
    error: { label: 'Error', description: 'The API request failed' },
}

const TEMPLATE = `
<div class="tcs">
  <h3 class="mb-1">Claude Code</h3>
  <div class="text-muted mb-4">
    Shows each Claude Code session's state on its tab and notifies you when it needs you.
    Plugin v{{version}}.
  </div>

  <!-- ───────────── Hooks ───────────── -->
  <h4 class="mt-3">1 · Connect Claude Code</h4>
  <div class="text-muted mb-2">
    Claude reports its state through hooks in <code>~/.claude/settings.json</code>.
    Install them wherever you run <code>claude</code>. Restart running sessions afterwards.
  </div>

  <div *ngIf="loadingTargets" class="text-muted p-2"><i class="fas fa-circle-notch fa-spin me-2"></i>Looking for WSL distros…</div>
  <div *ngIf="!loadingTargets && !rows.length" class="alert alert-warning">
    No WSL distro found. Install the hooks manually on the machine where Claude runs —
    see <a href="https://github.com/PedroRF2008/tabby-claude-state#install" target="_blank">the README</a>.
  </div>

  <div class="tcs-target" *ngFor="let row of rows">
    <div class="d-flex align-items-center">
      <div class="flex-grow-1">
        <div class="title"><strong>{{row.target.label}}</strong></div>
        <div class="small" [ngClass]="statusClass(row)">
          <i class="fas me-1" [ngClass]="statusIcon(row)"></i>{{statusText(row)}}
        </div>
      </div>
      <button class="btn btn-secondary ms-2" (click)="refresh(row)" [disabled]="row.busy" title="Re-check">
        <i class="fas fa-sync" [class.fa-spin]="row.busy"></i>
      </button>
      <button class="btn ms-2" [ngClass]="needsInstall(row) ? 'btn-primary' : 'btn-secondary'"
              (click)="install(row)" [disabled]="row.busy || !canInstall(row)">
        {{ isInstalled(row) && !isOutdated(row) ? 'Reinstall' : (isOutdated(row) ? 'Update' : 'Install') }}
      </button>
      <button class="btn btn-secondary ms-2" (click)="uninstall(row)" [disabled]="row.busy || !isInstalled(row)">Remove</button>
    </div>
    <div class="small mt-1" *ngIf="row.status?.ccm">
      <span class="ok" *ngIf="row.status!.ccmShared.length">
        <i class="fas fa-check-circle me-1"></i>CCM: Published Profiles and Local Profile{{row.status!.ccmShared.length > 1 ? 's' : ''}}
        {{row.status!.ccmShared.join(', ')}} use these hooks.
      </span>
      <span class="ok" *ngIf="!row.status!.ccmShared.length && !row.status!.ccmUnlinked.length">
        <i class="fas fa-check-circle me-1"></i>CCM: Published Profiles use these hooks.
      </span>
      <div class="warn" *ngIf="row.status!.ccmUnlinked.length">
        <i class="fas fa-exclamation-circle me-1"></i>CCM Local Profile{{row.status!.ccmUnlinked.length > 1 ? 's' : ''}}
        {{row.status!.ccmUnlinked.join(', ')}}: <code>settings.json</code> isn't linked to the real one, so tabs
        won't change colour there. <code>ccm doctor</code> reports it; CCM leaves the file alone
        on purpose, so move it aside and run <code>ccm use</code> to get the link back.
      </div>
    </div>
    <pre class="tcs-log mt-2" *ngIf="row.log">{{row.log}}</pre>
  </div>
  <div class="text-muted small mt-1" *ngIf="isWindows">
    Native Windows (PowerShell) sessions aren't supported yet. SSH hosts: run
    <code>scripts/install-hooks.sh</code> from the repo on that host.
  </div>

  <!-- ───────────── Notifications ───────────── -->
  <h4 class="mt-4">2 · Notifications</h4>

  <div class="form-line" *ngFor="let s of toastStates">
    <div class="header">
      <div class="title">{{labels[s].label}}</div>
      <div class="description">{{labels[s].description}}</div>
    </div>
    <button class="btn btn-link me-2" (click)="testToast(s)" title="Show a test notification">Test</button>
    <toggle [(ngModel)]="cfg.toast[s]" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Only when I'm not looking</div>
      <div class="description">Skip the notification if that tab is already in front of you</div>
    </div>
    <toggle [(ngModel)]="cfg.toast.onlyWhenUnseen" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Include Claude's message</div>
      <div class="description">Show the permission request, question or final reply in the notification</div>
    </div>
    <toggle [(ngModel)]="cfg.toast.showMessage" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Minimum turn length for "Done"</div>
      <div class="description">Don't notify for quick answers shorter than this (seconds)</div>
    </div>
    <input class="form-control tcs-num" type="number" min="0" [(ngModel)]="cfg.toast.doneMinSeconds" (ngModelChange)="save()">
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Silent</div>
      <div class="description">Don't play the system notification sound</div>
    </div>
    <toggle [(ngModel)]="cfg.toast.silent" (ngModelChange)="save()"></toggle>
  </div>

  <!-- ───────────── Tab appearance ───────────── -->
  <h4 class="mt-4">3 · Tab appearance</h4>

  <div class="form-line" *ngFor="let s of colorStates">
    <div class="header">
      <div class="title">{{labels[s].label}} colour</div>
      <div class="description">{{labels[s].description}}</div>
    </div>
    <span class="tcs-swatch me-2" [style.background]="cfg.colors[s]"></span>
    <input class="form-control tcs-color" type="color" [(ngModel)]="cfg.colors[s]" (ngModelChange)="save()">
  </div>
  <div class="form-line">
    <div class="header"><div class="title">Reset colours</div></div>
    <button class="btn btn-secondary" (click)="resetColors()">Reset to defaults</button>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Progress sweep while working</div>
      <div class="description">Animated bar in the tab header</div>
    </div>
    <toggle [(ngModel)]="cfg.progress" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Activity dot</div>
      <div class="description">For Needs you / Done / Error</div>
    </div>
    <toggle [(ngModel)]="cfg.activityDot" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line" *ngFor="let s of toastStates">
    <div class="header">
      <div class="title">Flash taskbar on "{{labels[s].label}}"</div>
      <div class="description">Only while the Tabby window is in the background</div>
    </div>
    <toggle [(ngModel)]="cfg.flash[s]" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Clear "Done" after viewing (ms)</div>
      <div class="description">How long the green bar stays once you've focused the tab</div>
    </div>
    <input class="form-control tcs-num" type="number" min="0" step="500" [(ngModel)]="cfg.doneClearDelayMs" (ngModelChange)="save()">
  </div>

  <!-- ───────────── Launch ───────────── -->
  <h4 class="mt-4">4 · Launch Claude Code</h4>
  <div class="text-muted mb-2">
    Open Claude Code in WSL as a specific CCM Profile (<code>ccm run &lt;profile&gt; -- claude</code>).
    These also appear in Tabby's profile picker (<strong>Ctrl+Shift+E</strong>) and New tab menu as
    "Claude · &lt;profile&gt;".
  </div>

  <div class="form-line">
    <div class="header"><div class="title">Show Claude Code profiles</div></div>
    <toggle [(ngModel)]="cfg.launch.enabled" (ngModelChange)="save()"></toggle>
  </div>

  <div class="form-line" *ngIf="ccmDistros.length > 1">
    <div class="header">
      <div class="title">WSL distro</div>
      <div class="description">Which distro's CCM Profiles to offer</div>
    </div>
    <select class="form-control tcs-select" [(ngModel)]="cfg.launch.distro" (ngModelChange)="save()">
      <option value="">All distros</option>
      <option *ngFor="let d of ccmDistros" [value]="d.target.distro">{{d.target.distro}}</option>
    </select>
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Start folder</div>
      <div class="description">WSL path the new tab opens in (<code>~</code> is your home)</div>
    </div>
    <input class="form-control tcs-folder" type="text" [(ngModel)]="cfg.launch.folder" (ngModelChange)="save()" placeholder="~">
  </div>

  <div class="form-line">
    <div class="header">
      <div class="title">Skip permission prompts</div>
      <div class="description">Start Claude with <code>--dangerously-skip-permissions</code></div>
    </div>
    <toggle [(ngModel)]="cfg.launch.skipPermissions" (ngModelChange)="save()"></toggle>
  </div>

  <div class="d-flex align-items-center mt-3 mb-2">
    <strong class="flex-grow-1">CCM Profiles</strong>
    <button class="btn btn-secondary" (click)="refreshCcm()" [disabled]="ccmBusy" title="Re-read ccm list">
      <i class="fas fa-sync me-1" [class.fa-spin]="ccmBusy"></i>Refresh
    </button>
  </div>
  <div *ngIf="ccmBusy && !ccmDistros.length" class="text-muted p-2"><i class="fas fa-circle-notch fa-spin me-2"></i>Asking CCM…</div>
  <div class="tcs-target" *ngFor="let d of visibleCcmDistros()">
    <div class="title mb-1"><strong>WSL · {{d.target.distro}}</strong>
      <span class="small text-muted" *ngIf="d.state?.kind === 'ok'"> · Store: {{storeText(d)}}</span>
    </div>
    <div *ngIf="!d.state" class="small text-muted"><i class="fas fa-circle-notch fa-spin me-1"></i>Checking…</div>
    <div *ngIf="d.state?.kind === 'missing'" class="small warn">
      <i class="fas fa-exclamation-circle me-1"></i>CCM isn't installed here — only plain Claude Code is offered.
    </div>
    <div *ngIf="d.state?.kind === 'too-old'" class="small warn">
      <i class="fas fa-exclamation-circle me-1"></i>Update CCM: this needs <code>ccm list --json</code>
      (re-run CCM's <code>install.sh</code>). Plain Claude Code is offered meanwhile.
    </div>
    <div *ngIf="d.state?.kind === 'error'" class="small bad">
      <i class="fas fa-times-circle me-1"></i>{{errorText(d)}}
    </div>
    <ng-container *ngIf="d.state?.kind === 'ok'">
      <div *ngIf="!profilesOf(d).length" class="small text-muted">
        No CCM Profiles yet — create one with <code>ccm login &lt;name&gt;</code>.
      </div>
      <div class="d-flex align-items-center tcs-profile" *ngFor="let p of profilesOf(d)">
        <div class="flex-grow-1">
          <strong>{{p.profile}}</strong>
          <span class="badge bg-secondary ms-2">{{p.kind === 'local' ? 'Local' : 'Published'}}</span>
          <span class="badge bg-success ms-1" *ngIf="p.active">active</span>
          <div class="small text-muted">{{p.account}}</div>
        </div>
        <button class="btn btn-primary" (click)="openClaude(d, p.profile)">
          <i class="fas fa-terminal me-1"></i>Open
        </button>
      </div>
      <div class="d-flex align-items-center tcs-profile">
        <div class="flex-grow-1 text-muted">Active CCM Profile (whatever <code>ccm use</code> selected)</div>
        <button class="btn btn-secondary" (click)="openClaude(d, null)">Open</button>
      </div>
    </ng-container>
    <div *ngIf="d.state && d.state.kind !== 'ok' && d.state.kind !== 'error'" class="d-flex justify-content-end mt-1">
      <button class="btn btn-secondary" (click)="openClaude(d, null)">Open Claude Code</button>
    </div>
  </div>

  <!-- ───────────── Advanced ───────────── -->
  <h4 class="mt-4">Advanced</h4>
  <div class="form-line">
    <div class="header"><div class="title">Enabled</div></div>
    <toggle [(ngModel)]="cfg.enabled" (ngModelChange)="save()"></toggle>
  </div>
  <div class="form-line">
    <div class="header">
      <div class="title">Debug logging</div>
      <div class="description">Log state changes to DevTools (Ctrl+Shift+Alt+I)</div>
    </div>
    <toggle [(ngModel)]="cfg.debug" (ngModelChange)="save()"></toggle>
  </div>
</div>
`

const STYLES = `
.tcs-target { border: 1px solid rgba(128,128,128,.25); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
.tcs-log { max-height: 160px; overflow: auto; font-size: 11px; opacity: .8; white-space: pre-wrap; margin: 0; }
.tcs-color { width: 60px; padding: 2px; height: 32px; flex: none; }
.tcs-num { width: 110px; flex: none; }
.tcs-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; flex: none; }
.ok { color: #22c55e; } .warn { color: #f59e0b; } .bad { color: #ef4444; }
.tcs-folder { width: 260px; flex: none; }
.tcs-select { width: 200px; flex: none; }
.tcs-profile { padding: 6px 0; border-top: 1px solid rgba(128,128,128,.15); }
`

@Component({
    template: TEMPLATE,
    styles: [STYLES],
})
export class ClaudeStateSettingsTabComponent implements OnInit, OnDestroy {
    version = PLUGIN_VERSION
    labels = STATE_LABELS
    toastStates: ClaudeState[] = ['waiting', 'done', 'error']
    colorStates: ClaudeState[] = ['working', 'waiting', 'done', 'error']
    rows: TargetRow[] = []
    loadingTargets = true
    ccmBusy = false
    private ccmSub?: Subscription

    constructor (
        public config: ConfigService,
        private installer: HookInstallerService,
        private notifier: ClaudeNotifierService,
        private ccm: CcmService,
        private profiles: ProfilesService,
        private notifications: NotificationsService,
        private zone: NgZone,
        private cdr: ChangeDetectorRef,
    ) { }

    ngOnDestroy (): void {
        this.ccmSub?.unsubscribe()
    }

    // ── launch ──

    get ccmDistros (): DistroCcm[] {
        return this.ccm.snapshot
    }

    visibleCcmDistros (): DistroCcm[] {
        const only = this.cfg.launch?.distro
        return this.ccm.snapshot.filter(d => !only || d.target.distro === only)
    }

    profilesOf (d: DistroCcm): CcmProfile[] {
        return d.state?.kind === 'ok' ? d.state.list.profiles : []
    }

    storeText (d: DistroCcm): string {
        if (d.state?.kind !== 'ok') {
            return ''
        }
        const s = d.state.list.store
        return !s.enabled || s.status === 'off' ? 'off' : s.status
    }

    errorText (d: DistroCcm): string {
        return d.state?.kind === 'error' ? `Couldn't read CCM Profiles: ${d.state.detail}` : ''
    }

    async refreshCcm (): Promise<void> {
        this.update(() => { this.ccmBusy = true })
        try {
            await this.ccm.refresh()
        } finally {
            this.update(() => { this.ccmBusy = false })
        }
    }

    async openClaude (d: DistroCcm, profile: string | null): Promise<void> {
        const id = `local:${shellId(d.target.distro!, profile)}`
        const all = await this.profiles.getProfiles()
        const found = all.find(p => p.id === id)
        if (!found) {
            this.notifications.error('Claude Code profile not found', 'Turn on "Show Claude Code profiles" and press Refresh.')
            return
        }
        await this.profiles.openNewTabForProfile(found)
    }

    get cfg (): any {
        return (this.config.store as any).claudeState
    }

    get isWindows (): boolean {
        return this.installer.isWindows
    }

    async ngOnInit (): Promise<void> {
        this.ccmSub = this.ccm.changed$.subscribe(() => this.update(() => { }))
        this.refreshCcm().catch(() => { })
        const targets = await this.installer.listTargets()
        this.update(() => {
            this.rows = targets.map(target => ({ target, status: null, busy: true, log: '' }))
            this.loadingTargets = false
        })
        await Promise.all(this.rows.map(row => this.refresh(row)))
    }

    save (): void {
        this.config.save()
    }

    resetColors (): void {
        Object.assign(this.cfg.colors, DEFAULT_COLORS)
        this.save()
    }

    testToast (state: ClaudeState): void {
        const samples: Record<string, string> = {
            waiting: 'Permission: Bash: npm test',
            done: 'All tests pass. I updated the parser and added two cases for split chunks.',
            error: 'API Error: 529 overloaded',
        }
        this.notifier.show({ state, project: 'my-project', message: samples[state] ?? '', elapsedMs: state === 'done' ? 252000 : undefined })
    }

    // ── hooks ──

    async refresh (row: TargetRow): Promise<void> {
        this.update(() => { row.busy = true })
        const status = await this.installer.status(row.target)
        this.update(() => {
            row.status = status
            row.busy = false
        })
    }

    async install (row: TargetRow): Promise<void> {
        await this.run(row, () => this.installer.install(row.target))
    }

    async uninstall (row: TargetRow): Promise<void> {
        await this.run(row, () => this.installer.uninstall(row.target))
    }

    isInstalled (row: TargetRow): boolean {
        return !!row.status?.hookVersion && !!row.status?.configured
    }

    isOutdated (row: TargetRow): boolean {
        return this.isInstalled(row) && row.status!.hookVersion !== this.version
    }

    needsInstall (row: TargetRow): boolean {
        return !this.isInstalled(row) || this.isOutdated(row)
    }

    canInstall (row: TargetRow): boolean {
        return !!row.status?.reachable && !!row.status?.python
    }

    statusText (row: TargetRow): string {
        const s = row.status
        if (!s) {
            return 'Checking…'
        }
        if (!s.reachable) {
            return `Can't reach this distro${s.error ? ': ' + s.error.split('\n')[0] : ''}`
        }
        if (!s.python) {
            return 'python3 is required for the installer (sudo apt install python3)'
        }
        const claude = s.claude ? '' : ' · claude CLI not found on PATH'
        if (this.isOutdated(row)) {
            return `Hooks v${s.hookVersion} installed — update to v${this.version} available${claude}`
        }
        if (this.isInstalled(row)) {
            return `Hooks installed (v${s.hookVersion})${claude}`
        }
        if (s.hookVersion || s.configured) {
            return `Partially installed — reinstall to repair${claude}`
        }
        return `Not installed${claude}`
    }

    statusClass (row: TargetRow): string {
        if (!row.status) {
            return 'text-muted'
        }
        if (!row.status.reachable || !row.status.python) {
            return 'bad'
        }
        return this.needsInstall(row) ? 'warn' : 'ok'
    }

    statusIcon (row: TargetRow): string {
        const c = this.statusClass(row)
        return c === 'ok' ? 'fa-check-circle' : c === 'bad' ? 'fa-times-circle' : c === 'warn' ? 'fa-exclamation-circle' : 'fa-circle-notch fa-spin'
    }

    private async run (row: TargetRow, fn: () => Promise<string>): Promise<void> {
        this.update(() => {
            row.busy = true
            row.log = ''
        })
        try {
            const out = await fn()
            this.update(() => { row.log = out.trim() })
        } catch (e: any) {
            this.update(() => { row.log = 'Failed: ' + String(e?.message ?? e) })
        }
        await this.refresh(row)
    }

    private update (fn: () => void): void {
        this.zone.run(() => {
            fn()
            this.cdr.markForCheck()
        })
    }
}
