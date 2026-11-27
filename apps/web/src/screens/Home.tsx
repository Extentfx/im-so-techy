import { useCallback, useEffect, useState } from 'react';
import { friendly } from '../lib/api';
import {
  actOnDevice,
  allowDevice,
  connectHome,
  createScene,
  deleteScene,
  disconnectHome,
  getDevices,
  getEntities,
  getScenes,
  homeConfig,
  removeDevice,
  runScene,
  setRoutine,
  type Device,
  type Entity,
  type Scene,
} from '../lib/homeApi';
import { useError } from '../lib/useError';
import { GlassButton, GlassCard } from '../components/Glass';

const inputCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-black/10 bg-white/50 px-3 text-base dark:border-white/20 dark:bg-white/10';
const LABEL: Record<string, string> = {
  on: 'On',
  off: 'Off',
  toggle: 'Toggle',
  lock: 'Lock',
  unlock: 'Unlock',
  open: 'Open',
  close: 'Close',
  arm_away: 'Arm away',
};

interface Pending {
  device: Device;
  action: string;
  token: string;
  message: string;
}

export function Home() {
  const [host, setHost] = useState<string | null | undefined>(undefined);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useError();
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [sceneRoutine, setSceneRoutine] = useState<'' | 'wind-down' | 'wake'>('');
  const [sceneSteps, setSceneSteps] = useState<Record<string, 'on' | 'off'>>({});
  const [temps, setTemps] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const c = await homeConfig();
      setHost(c.configured ? c.host : null);
      if (c.configured) {
        const [d, s] = await Promise.all([getDevices(), getScenes()]);
        setDevices(d);
        setScenes(s);
      }
    } catch (e) {
      setError(friendly(e));
      setHost((h) => (h === undefined ? null : h));
    }
  }, [setError]);
  useEffect(() => void load(), [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    }
    await load();
  };

  const act = (d: Device, action: string, value?: number, confirmToken?: string) =>
    guard(async () => {
      const r = await actOnDevice({ entityId: d.entityId, action, value, confirmToken });
      if (r.needsConfirm && r.token)
        setPending({
          device: d,
          action,
          token: r.token,
          message: r.message ?? 'Confirm this action',
        });
      else {
        setPending(null);
        setNote(`${d.name}: ${LABEL[action] ?? action} sent`);
      }
    });

  if (host === undefined) return null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="px-1 pt-2">
        <h1 className="font-display text-5xl italic leading-tight">Home</h1>
      </header>
      {error && (
        <GlassCard role="alert" className="text-sm">
          {error}
        </GlassCard>
      )}
      {note && (
        <p role="status" className="px-1 text-sm text-[var(--ok)]">
          {note}
        </p>
      )}

      {!host ? (
        <GlassCard aria-label="Connect Home Assistant" className="grid gap-3">
          <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
            Connect Home Assistant
          </h2>
          <p className="text-sm text-[var(--ink-soft)]">
            Home Assistant is the bridge to your lights, thermostat and plugs. Reach it through a
            Cloudflare Tunnel or Tailscale address (never expose it directly to the internet). In
            Home Assistant, create a long-lived access token under your profile. The address and
            token are stored encrypted and never shown again.
          </p>
          <input
            aria-label="Home Assistant address"
            className={inputCls}
            placeholder="https://home.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            aria-label="Long-lived access token"
            className={inputCls}
            type="password"
            autoComplete="off"
            placeholder="Long-lived access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <GlassButton
            variant="solid"
            disabled={busy || !url || token.length < 20}
            className="justify-self-end"
            onClick={async () => {
              setBusy(true);
              await guard(() =>
                connectHome(url, token).then(() => {
                  setToken('');
                  setUrl('');
                }),
              );
              setBusy(false);
            }}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </GlassButton>
        </GlassCard>
      ) : (
        <>
          <GlassCard aria-label="Devices" className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
                Devices · {host}
              </h2>
              <button
                type="button"
                className="min-h-11 px-2 text-xs text-[var(--ink-soft)]"
                onClick={() =>
                  window.confirm(
                    'Disconnect Home Assistant? Your device list stays, but nothing can be controlled.',
                  ) && guard(disconnectHome)
                }
              >
                Disconnect
              </button>
            </div>
            {pending && (
              <div
                role="alertdialog"
                aria-label="Confirm action"
                className="grid gap-2 rounded-2xl border border-[var(--accent)] p-3 text-sm"
              >
                <p className="font-medium">
                  {pending.message.replace(pending.device.name ? '' : '', '')}
                </p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {pending.device.name}: {LABEL[pending.action] ?? pending.action}
                </p>
                <div className="flex gap-2">
                  <GlassButton
                    variant="solid"
                    onClick={() => act(pending.device, pending.action, undefined, pending.token)}
                  >
                    Confirm
                  </GlassButton>
                  <GlassButton onClick={() => setPending(null)}>Cancel</GlassButton>
                </div>
              </div>
            )}
            {devices.length === 0 && (
              <p className="text-sm text-[var(--ink-soft)]">
                No devices yet. Add the ones you want this app to control; everything else stays off
                limits.
              </p>
            )}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {devices.map((d) => (
                <li key={d.entityId} className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {d.name}
                        {d.sensitive ? ' 🔒' : ''}
                      </p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {d.entityId} · {d.state ?? 'unknown'}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${d.name}`}
                      className="min-h-11 min-w-11 text-[var(--ink-soft)]"
                      onClick={() => guard(() => removeDevice(d.entityId))}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.actions
                      .filter((a) => a !== 'set_temperature')
                      .map((a) => (
                        <GlassButton key={a} className="!min-h-10" onClick={() => act(d, a)}>
                          {LABEL[a] ?? a}
                        </GlassButton>
                      ))}
                    {d.actions.includes('set_temperature') && (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const v = Number(temps[d.entityId]);
                          if (v) void act(d, 'set_temperature', v);
                        }}
                      >
                        <input
                          aria-label={`${d.name} temperature (°C)`}
                          className={`${inputCls} !w-24`}
                          inputMode="decimal"
                          placeholder="°C"
                          value={temps[d.entityId] ?? ''}
                          onChange={(e) => setTemps({ ...temps, [d.entityId]: e.target.value })}
                        />
                        <GlassButton type="submit" className="!min-h-10">
                          Set
                        </GlassButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div>
              {entities === null ? (
                <GlassButton
                  onClick={() => getEntities().then(setEntities, (e) => setError(friendly(e)))}
                >
                  Add a device
                </GlassButton>
              ) : (
                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-sm font-medium">Pick a device to allow</legend>
                  {entities
                    .filter((e) => !e.allowlisted)
                    .map((e) => (
                      <button
                        key={e.entityId}
                        type="button"
                        className="flex min-h-11 items-center justify-between rounded-xl px-2 text-left text-sm hover:bg-[var(--glass-fill-strong)]"
                        onClick={() =>
                          guard(() => allowDevice(e.entityId, e.name).then(() => setEntities(null)))
                        }
                      >
                        <span>
                          {e.name}
                          {e.sensitive ? ' 🔒' : ''}
                        </span>
                        <span className="text-xs text-[var(--ink-soft)]">{e.domain}</span>
                      </button>
                    ))}
                  {entities.every((e) => e.allowlisted) && (
                    <p className="text-sm text-[var(--ink-soft)]">
                      Everything compatible is already added.
                    </p>
                  )}
                  <button
                    type="button"
                    className="min-h-11 justify-self-start text-sm text-[var(--accent-text)]"
                    onClick={() => setEntities(null)}
                  >
                    Close
                  </button>
                </fieldset>
              )}
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                🔒 Locks, garage doors and alarms always ask you to confirm first and are rate
                limited.
              </p>
            </div>
          </GlassCard>

          <GlassCard aria-label="Scenes" className="grid gap-3">
            <h2 className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">
              Scenes and routines
            </h2>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {scenes.map((s) => (
                <li key={s.id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {s.name}{' '}
                      <span className="text-xs font-normal text-[var(--ink-soft)]">
                        · {s.steps.length} step{s.steps.length > 1 ? 's' : ''}
                      </span>
                    </p>
                    <div className="flex gap-1">
                      <GlassButton
                        className="!min-h-10"
                        onClick={() =>
                          guard(() =>
                            runScene(s.id).then((r) =>
                              setNote(
                                `${s.name}: ${r.ran} done${r.failed.length ? `, ${r.failed.length} skipped` : ''}`,
                              ),
                            ),
                          )
                        }
                      >
                        Run
                      </GlassButton>
                      <button
                        type="button"
                        aria-label={`Delete ${s.name}`}
                        className="min-h-11 min-w-11 text-[var(--ink-soft)]"
                        onClick={() => guard(() => deleteScene(s.id))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {s.routine && (
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.routineEnabled}
                        onChange={(e) => guard(() => setRoutine(s.id, e.target.checked))}
                      />
                      Run automatically{' '}
                      {s.routine === 'wind-down'
                        ? '30 minutes before bedtime'
                        : '15 minutes before wake-up'}
                    </label>
                  )}
                </li>
              ))}
              {scenes.length === 0 && (
                <li className="text-sm text-[var(--ink-soft)]">No scenes yet.</li>
              )}
            </ul>
            {devices.some((d) => !d.sensitive) && (
              <details>
                <summary className="min-h-11 cursor-pointer text-sm text-[var(--accent-text)]">
                  New scene
                </summary>
                <div className="mt-2 grid gap-2">
                  <input
                    aria-label="Scene name"
                    className={inputCls}
                    placeholder="e.g. Wind down"
                    value={sceneName}
                    onChange={(e) => setSceneName(e.target.value)}
                  />
                  <select
                    aria-label="Routine"
                    className={inputCls}
                    value={sceneRoutine}
                    onChange={(e) => setSceneRoutine(e.target.value as '' | 'wind-down' | 'wake')}
                  >
                    <option value="">Manual only</option>
                    <option value="wind-down">Wind-down before bedtime</option>
                    <option value="wake">Wake light before wake-up</option>
                  </select>
                  {devices
                    .filter((d) => !d.sensitive && d.actions.includes('off'))
                    .map((d) => (
                      <label
                        key={d.entityId}
                        className="flex min-h-11 items-center justify-between gap-2 text-sm"
                      >
                        {d.name}
                        <select
                          aria-label={`${d.name} in scene`}
                          className="rounded-lg border border-black/10 bg-white/50 px-2 py-2 dark:border-white/20 dark:bg-white/10"
                          value={sceneSteps[d.entityId] ?? ''}
                          onChange={(e) =>
                            setSceneSteps((s) => {
                              const n = { ...s };
                              if (e.target.value) n[d.entityId] = e.target.value as 'on' | 'off';
                              else delete n[d.entityId];
                              return n;
                            })
                          }
                        >
                          <option value="">Skip</option>
                          <option value="on">Turn on</option>
                          <option value="off">Turn off</option>
                        </select>
                      </label>
                    ))}
                  <GlassButton
                    variant="solid"
                    className="justify-self-end"
                    disabled={!sceneName.trim() || Object.keys(sceneSteps).length === 0}
                    onClick={() =>
                      guard(() =>
                        createScene({
                          name: sceneName.trim(),
                          routine: sceneRoutine || null,
                          steps: Object.entries(sceneSteps).map(([entityId, action]) => ({
                            entityId,
                            action,
                          })),
                        }).then(() => {
                          setSceneName('');
                          setSceneSteps({});
                          setSceneRoutine('');
                        }),
                      )
                    }
                  >
                    Save scene
                  </GlassButton>
                </div>
              </details>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
