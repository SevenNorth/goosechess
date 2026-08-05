import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Clock3,
  Dices,
  FilePlus2,
  FlaskConical,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, contentApi } from './api'
import { DEFAULT_EVENT, effectForType, eventFromUnknown, simulateCheck } from './event-model'
import { eventPoolOptions, type EventPoolOption } from './event-pools'
import './event-pools.css'
import { useAuth } from './auth-context'
import type {
  AuditEntry,
  ContentDraft,
  ContentRelease,
  DraftStatus,
  EventEffect,
  EventKind,
  ManagedEventContent,
} from './types'

const statusLabels: Record<DraftStatus, string> = {
  draft: '草稿',
  'in-review': '待审核',
  approved: '已通过',
  rejected: '已驳回',
  published: '已发布',
}

const actionLabels: Record<string, string> = {
  'draft.created': '创建草稿',
  'draft.revised': '保存修订',
  'draft.submitted': '提交审核',
  'draft.approved': '审核通过',
  'draft.rejected': '驳回草稿',
  'release.published': '发布版本',
  'release.rolled-back': '回滚版本',
}

const effectLabels: Record<EventEffect['type'], string> = {
  move: '自己移动',
  'move-to-next-landmark': '自己移动到下一个地点',
  'opponent-move': '对手移动',
  skip: '暂停回合',
  'world-max-die': '限制骰面',
  'extra-turn': '额外回合',
  'gain-item': '获得道具',
  swap: '交换位置',
}

function messageFrom(cause: unknown) {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : '内容服务请求失败。'
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(timestamp)
}

function DraftList({
  drafts,
  selectedId,
  loading,
  onRefresh,
}: {
  readonly drafts: readonly ContentDraft[]
  readonly selectedId?: string
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  const navigate = useNavigate()
  return (
    <aside className="draft-browser" aria-label="事件草稿">
      <div className="panel-heading">
        <div><small>EVENT DRAFTS</small><strong>事件草稿</strong></div>
        <button type="button" title="刷新草稿" aria-label="刷新草稿" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? 'is-spinning' : ''} />
        </button>
      </div>
      <button className="new-draft-button" type="button" onClick={() => navigate('/events/new')}>
        <FilePlus2 aria-hidden="true" />新建事件
      </button>
      <div className="draft-list">
        {drafts.length === 0 && !loading ? (
          <div className="empty-list"><SparkleMark /><strong>还没有事件草稿</strong><span>创建第一张结构化事件卡</span></div>
        ) : null}
        {drafts.map((draft) => (
          <button
            type="button"
            key={draft.id}
            className={draft.id === selectedId ? 'draft-row is-selected' : 'draft-row'}
            onClick={() => navigate(`/events/${draft.id}`)}
          >
            <span className={`status-dot status-${draft.status}`} aria-hidden="true" />
            <span className="draft-row-copy">
              <strong>{draft.title}</strong>
              <small>修订 {draft.currentRevision} · {formatTime(draft.updatedAt)}</small>
            </span>
            <span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span>
            <ChevronRight aria-hidden="true" />
          </button>
        ))}
      </div>
    </aside>
  )
}

function SparkleMark() {
  return <span className="empty-mark" aria-hidden="true">鹅</span>
}

function EffectEditor({
  title,
  effects,
  disabled,
  onChange,
}: {
  readonly title: string
  readonly effects: EventEffect[]
  readonly disabled: boolean
  readonly onChange: (effects: EventEffect[]) => void
}) {
  function replace(index: number, effect: EventEffect) {
    onChange(effects.map((current, currentIndex) => currentIndex === index ? effect : current))
  }
  return (
    <fieldset className="effect-fieldset" disabled={disabled}>
      <legend>{title}</legend>
      {effects.map((effect, index) => (
        <div className="effect-row" key={`${effect.type}-${index}`}>
          <select
            aria-label={`${title} ${index + 1} 类型`}
            value={effect.type}
            onChange={(event) => replace(index, effectForType(event.target.value as EventEffect['type']))}
          >
            {Object.entries(effectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {(effect.type === 'move' || effect.type === 'opponent-move') ? (
            <label className="inline-number"><span>格数</span><input type="number" value={effect.spaces} onChange={(event) => replace(index, { ...effect, spaces: Number(event.target.value) })} /></label>
          ) : null}
          {effect.type === 'skip' ? (
            <label className="inline-number"><span>回合</span><input type="number" min="1" value={effect.turns} onChange={(event) => replace(index, { ...effect, turns: Number(event.target.value) })} /></label>
          ) : null}
          {effect.type === 'world-max-die' ? (
            <>
              <label className="inline-number"><span>最大点</span><input type="number" min="1" max="6" value={effect.value} onChange={(event) => replace(index, { ...effect, value: Number(event.target.value) })} /></label>
              <label className="inline-number"><span>轮数</span><input type="number" min="1" value={effect.rounds} onChange={(event) => replace(index, { ...effect, rounds: Number(event.target.value) })} /></label>
            </>
          ) : <span className="effect-summary">{effectLabels[effect.type]}</span>}
          <button type="button" title="删除效果" aria-label={`删除${title} ${index + 1}`} disabled={effects.length === 1} onClick={() => onChange(effects.filter((_, currentIndex) => currentIndex !== index))}>
            <Trash2 />
          </button>
        </div>
      ))}
      <button className="add-effect-button" type="button" onClick={() => onChange([...effects, { type: 'move', spaces: 1 }])}>
        <Plus aria-hidden="true" />添加效果
      </button>
    </fieldset>
  )
}

function EventForm({
  content,
  draft,
  disabled,
  poolOptions,
  onChange,
}: {
  readonly content: ManagedEventContent
  readonly draft: ContentDraft | null
  readonly disabled: boolean
  readonly poolOptions: readonly EventPoolOption[]
  readonly onChange: (content: ManagedEventContent) => void
}) {
  function patch(values: Partial<ManagedEventContent>) {
    onChange({ ...content, ...values })
  }
  function changeKind(kind: EventKind) {
    if (kind === '骰子检定') {
      patch({ kind, threshold: content.threshold ?? 7, success: content.success ?? content.effect ?? [{ type: 'move', spaces: 1 }], failure: content.failure ?? [{ type: 'skip', turns: 1 }], failureText: content.failureText ?? '', effect: undefined })
    } else {
      patch({ kind, effect: content.effect ?? content.success ?? [{ type: 'move', spaces: 1 }], threshold: undefined, success: undefined, failure: undefined, failureText: undefined })
    }
  }
  return (
    <div className="event-form">
      <section className="form-section">
        <div className="section-title"><span>01</span><div><strong>基本信息</strong><small>标识、标题与叙事内容</small></div></div>
        <div className="form-grid two-columns">
          <label><span>事件 ID</span><input value={content.id} disabled={disabled || Boolean(draft)} placeholder="harbor-shortcut" onChange={(event) => patch({ id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label>
          <label><span>事件标题</span><input value={content.title} disabled={disabled} placeholder="港口捷径" onChange={(event) => patch({ title: event.target.value })} /></label>
        </div>
        <label><span>叙事说明</span><textarea rows={3} value={content.flavor} disabled={disabled} placeholder="描述玩家遇到的情境…" onChange={(event) => patch({ flavor: event.target.value })} /></label>
      </section>
      <section className="form-section">
        <div className="section-title"><span>02</span><div><strong>分类与权重</strong><small>事件池、视觉色调和 AI 评价</small></div></div>
        <div className="form-grid four-columns">
          <label><span>事件类别</span><select value={content.kind} disabled={disabled} onChange={(event) => changeKind(event.target.value as EventKind)}><option>常规事件</option><option>骰子检定</option><option>奇遇事件</option></select></label>
          <label><span>强调色</span><select value={content.accent} disabled={disabled} onChange={(event) => patch({ accent: event.target.value as ManagedEventContent['accent'] })}><option value="teal">青绿</option><option value="coral">珊瑚红</option><option value="gold">金黄</option></select></label>
          <label><span>AI 评分</span><input type="number" min="0" max="10" value={content.aiValue} disabled={disabled} onChange={(event) => patch({ aiValue: Number(event.target.value) })} /></label>
          <label><span>抽取权重</span><input type="number" min="1" value={content.weight} disabled={disabled} onChange={(event) => patch({ weight: Number(event.target.value) })} /></label>
        </div>
        <fieldset className="event-pool-fieldset" disabled={disabled}>
          <legend>事件池归属</legend>
          <div className="event-pool-options">
            {poolOptions.map((option) => (
              <label className="event-pool-option" key={option.id}>
                <input
                  type="checkbox"
                  checked={content.poolIds.includes(option.id)}
                  onChange={(event) => patch({
                    poolIds: event.target.checked
                      ? [...content.poolIds, option.id]
                      : content.poolIds.filter((id) => id !== option.id),
                  })}
                />
                <span><strong>{option.label}</strong><code>{option.id}</code></span>
              </label>
            ))}
          </div>
          <small>可同时归属多个事件池；地点选项来自默认地图和地图草稿。</small>
        </fieldset>
      </section>
      <section className="form-section">
        <div className="section-title"><span>03</span><div><strong>结算效果</strong><small>只允许结构化规则，不接受脚本</small></div></div>
        {content.kind === '骰子检定' ? (
          <>
            <label className="threshold-field"><span>双骰通过门槛</span><input type="number" min="2" max="12" value={content.threshold ?? 7} disabled={disabled} onChange={(event) => patch({ threshold: Number(event.target.value) })} /></label>
            <EffectEditor title="成功效果" effects={content.success ?? []} disabled={disabled} onChange={(success) => patch({ success })} />
            <label><span>成功文案</span><input value={content.successText} disabled={disabled} onChange={(event) => patch({ successText: event.target.value })} /></label>
            <EffectEditor title="失败效果" effects={content.failure ?? []} disabled={disabled} onChange={(failure) => patch({ failure })} />
            <label><span>失败文案</span><input value={content.failureText ?? ''} disabled={disabled} onChange={(event) => patch({ failureText: event.target.value })} /></label>
          </>
        ) : (
          <>
            <EffectEditor title="直接效果" effects={content.effect ?? []} disabled={disabled} onChange={(effect) => patch({ effect })} />
            <label><span>结果文案</span><input value={content.successText} disabled={disabled} onChange={(event) => patch({ successText: event.target.value })} /></label>
          </>
        )}
      </section>
    </div>
  )
}

function effectDescription(effect: EventEffect) {
  switch (effect.type) {
    case 'move': return `自己${effect.spaces >= 0 ? '前进' : '后退'} ${Math.abs(effect.spaces)} 格`
    case 'move-to-next-landmark': return '自己移动到下一个地点'
    case 'opponent-move': return `对手${effect.spaces >= 0 ? '前进' : '后退'} ${Math.abs(effect.spaces)} 格`
    case 'skip': return `暂停 ${effect.turns} 回合`
    case 'world-max-die': return `${effect.rounds} 轮内骰面上限 ${effect.value}`
    case 'extra-turn': return '立即获得额外回合'
    case 'gain-item': return '获得一件道具'
    case 'swap': return '与下一位对手交换位置'
  }
}

function EventPreview({ content, validation, candidates }: { readonly content: ManagedEventContent; readonly validation?: ContentDraft['validation']; readonly candidates: readonly ManagedEventContent[] }) {
  const [seed, setSeed] = useState(20260805)
  const [choiceOpen, setChoiceOpen] = useState(false)
  const choiceEvents = [content, ...candidates].slice(0, 3)
  const check = useMemo(() => content.kind === '骰子检定' ? simulateCheck(seed, content.threshold ?? 7, 100) : null, [content.kind, content.threshold, seed])
  return (
    <aside className="preview-panel" aria-label="事件预览">
      <div className="panel-heading"><div><small>LIVE PREVIEW</small><strong>游戏内预览</strong></div><FlaskConical aria-hidden="true" /></div>
      <article className={`event-preview-card accent-${content.accent}`}>
        <div className="event-card-top"><span>{content.kind}</span><strong>AI {content.aiValue}</strong></div>
        <div className="event-sketch" aria-hidden="true"><span>鹅</span><i /><i /></div>
        <h2>{content.title || '未命名事件'}</h2>
        <p>{content.flavor || '填写叙事说明后，这里会显示玩家看到的事件文本。'}</p>
        {content.kind === '骰子检定' ? <div className="check-badge"><Dices />双骰 ≥ {content.threshold ?? 7}</div> : null}
        <ul>
          {(content.kind === '骰子检定' ? content.success : content.effect)?.map((effect, index) => <li key={index}>{effectDescription(effect)}</li>)}
        </ul>
      </article>
      <button className="preview-stage-button" type="button" onClick={() => setChoiceOpen(true)}>
        <Dices aria-hidden="true" />打开三选一预览
      </button>
      {choiceOpen ? (
        <div className="choice-preview-backdrop" role="dialog" aria-modal="true" aria-label="三选一事件预览">
          <section className="choice-preview-stage">
            <header><div><small>THREE-CARD CHOICE</small><strong>事件三选一舞台</strong></div><button type="button" title="关闭预览" aria-label="关闭三选一预览" onClick={() => setChoiceOpen(false)}><X /></button></header>
            <div className="choice-preview-grid">
              {choiceEvents.map((event, index) => <article className={`choice-event-card accent-${event.accent}`} key={`${event.id}-${index}`}><span>{event.kind}</span><div aria-hidden="true">鹅</div><h2>{event.title || '未命名事件'}</h2><p>{event.flavor || '尚未填写事件叙事。'}</p><strong>{event.kind === '骰子检定' ? `双骰 ≥ ${event.threshold ?? 7}` : (event.effect?.[0] ? effectDescription(event.effect[0]) : '结构化效果')}</strong></article>)}
              {Array.from({ length: 3 - choiceEvents.length }, (_, index) => <article className="choice-event-card is-placeholder" key={`placeholder-${index}`}><span>候选位</span><div aria-hidden="true">+</div><h2>等待其他草稿</h2><p>创建更多事件后可一起比较文案长度、色调与效果摘要。</p></article>)}
            </div>
          </section>
        </div>
      ) : null}
      <section className="simulation-panel">
        <div><Dices aria-hidden="true" /><strong>固定种子模拟</strong></div>
        <label><span>种子</span><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        {check ? (
          <div className="simulation-result">
            <span className="dice-face">{check.dice[0]}</span><span className="dice-face">{check.dice[1]}</span>
            <div><strong>{check.dice[0] + check.dice[1] >= (content.threshold ?? 7) ? '本次通过' : '本次失败'}</strong><small>100 次通过率 {(check.rate * 100).toFixed(0)}%</small></div>
          </div>
        ) : <p>直接效果事件不进行骰子检定。</p>}
      </section>
      <section className={validation?.valid ? 'validation-panel is-valid' : 'validation-panel'}>
        <div>{validation?.valid ? <CheckCircle2 /> : <AlertCircle />}<strong>{validation ? (validation.valid ? '自动校验通过' : `${validation.issues.length} 项待修正`) : '保存后自动校验'}</strong></div>
        {validation?.issues.map((issue) => <p key={`${issue.path}-${issue.code}`}><code>{issue.path || 'content'}</code>{issue.message}</p>)}
      </section>
    </aside>
  )
}

export function EventWorkspace() {
  const { draftId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [mapDrafts, setMapDrafts] = useState<ContentDraft[]>([])
  const [draft, setDraft] = useState<ContentDraft | null>(null)
  const [content, setContent] = useState<ManagedEventContent>(structuredClone(DEFAULT_EVENT))
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewReason, setReviewReason] = useState('')

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await contentApi.listDrafts()
      setDrafts(response.drafts.filter((item) => item.kind === 'event'))
      setMapDrafts(response.drafts.filter((item) => item.kind === 'map'))
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadDrafts() }, [loadDrafts])

  useEffect(() => {
    let active = true
    setError(null)
    setNotice(null)
    if (!draftId) {
      setDraft(null)
      setContent(structuredClone(DEFAULT_EVENT))
      setDirty(false)
      return () => { active = false }
    }
    if (draftId === 'new') {
      setDraft(null)
      setContent(structuredClone(DEFAULT_EVENT))
      setDirty(false)
      return () => { active = false }
    }
    void contentApi.getDraft(draftId).then(({ draft: loaded }) => {
      if (!active) return
      setDraft(loaded)
      setContent(eventFromUnknown(loaded.content))
      setDirty(false)
    }).catch((cause) => { if (active) setError(messageFrom(cause)) })
    return () => { active = false }
  }, [draftId])

  function updateDraft(draftUpdate: ContentDraft) {
    setDraft(draftUpdate)
    setContent(eventFromUnknown(draftUpdate.content))
    setDirty(false)
    setDrafts((current) => [draftUpdate, ...current.filter((item) => item.id !== draftUpdate.id)])
  }

  async function save() {
    if (!content.id.trim() || !content.title.trim()) {
      setError('保存前必须填写事件 ID 和标题。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = draft
        ? await contentApi.updateEvent(draft.id, draft.currentRevision, content.title, content)
        : await contentApi.createEvent(content.title, content)
      updateDraft(response.draft)
      setNotice(`修订 ${response.draft.currentRevision} 已保存并完成自动校验。`)
      if (!draft) navigate(`/events/${response.draft.id}`, { replace: true })
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }

  async function transition(action: 'submit' | 'approve' | 'reject' | 'publish') {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (action === 'submit') {
        updateDraft((await contentApi.submitDraft(draft.id)).draft)
        setNotice('草稿已提交管理员审核。')
      } else if (action === 'publish') {
        const { release } = await contentApi.publishDraft(draft.id)
        const refreshed = await contentApi.getDraft(draft.id)
        updateDraft(refreshed.draft)
        setNotice(`已发布不可变版本 ${release.version}。`)
      } else {
        const decision = action === 'approve' ? 'approve' : 'reject'
        updateDraft((await contentApi.reviewDraft(draft.id, decision, reviewReason)).draft)
        setNotice(decision === 'approve' ? '审核已通过，可以发布。' : '草稿已驳回编辑。')
        setReviewReason('')
      }
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }

  const editable = !draft || draft.status === 'draft' || draft.status === 'rejected'
  const availablePoolOptions = useMemo(() => eventPoolOptions(mapDrafts, content.poolIds), [content.poolIds, mapDrafts])
  const activeId = draftId === 'new' ? undefined : draftId
  return (
    <div className="event-workspace">
      <DraftList drafts={drafts} selectedId={activeId} loading={loading} onRefresh={() => void loadDrafts()} />
      {!draftId ? (
        <main className="workspace-empty"><CirclePlus aria-hidden="true" /><strong>选择或创建事件草稿</strong><p>事件内容通过结构化字段进入校验、审核和不可变发布流程。</p><button className="primary-button" type="button" onClick={() => navigate('/events/new')}><FilePlus2 />新建事件</button></main>
      ) : (
        <main className="editor-panel">
          <header className="editor-toolbar">
            <div><small>{draft ? draft.contentKey : 'NEW EVENT'}</small><strong>{content.title || '新事件草稿'}</strong></div>
            <div className="toolbar-meta">{draft ? <><span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span><span>修订 {draft.currentRevision}</span></> : <span>尚未保存</span>}</div>
            <div className="toolbar-actions">
              {dirty ? <span className="unsaved-indicator"><Clock3 />未保存</span> : null}
              {editable ? <button className="primary-button" type="button" disabled={busy || (!dirty && Boolean(draft))} onClick={() => void save()}><Save />保存修订</button> : null}
              {draft && (draft.status === 'draft' || draft.status === 'rejected') ? <button className="secondary-button" type="button" disabled={busy || dirty || !draft.validation.valid} onClick={() => void transition('submit')}><Send />提交审核</button> : null}
              {draft?.status === 'in-review' && user?.role === 'admin' ? <><button className="secondary-button success-button" type="button" disabled={busy} onClick={() => void transition('approve')}><Check />通过</button><button className="secondary-button danger-button" type="button" disabled={busy || !reviewReason.trim()} onClick={() => void transition('reject')}><X />驳回</button></> : null}
              {draft?.status === 'approved' && user?.role === 'admin' ? <button className="primary-button" type="button" disabled={busy} onClick={() => void transition('publish')}><ShieldCheck />发布版本</button> : null}
            </div>
          </header>
          {draft?.status === 'in-review' && user?.role === 'admin' ? <label className="review-reason"><span>驳回原因</span><input value={reviewReason} placeholder="驳回时必填" onChange={(event) => setReviewReason(event.target.value)} /></label> : null}
          {error ? <div className="notice-banner is-error" role="alert"><AlertCircle />{error}</div> : null}
          {notice ? <div className="notice-banner is-success" role="status"><CheckCircle2 />{notice}</div> : null}
          <div className="editor-scroll"><EventForm content={content} draft={draft} disabled={!editable || busy} poolOptions={availablePoolOptions} onChange={(next) => { setContent(next); setDirty(true); setNotice(null) }} /></div>
        </main>
      )}
      {draftId ? <EventPreview content={content} validation={draft?.validation} candidates={drafts.filter((item) => item.id !== draft?.id).map((item) => eventFromUnknown(item.content))} /> : null}
    </div>
  )
}

export function ReleasesPage() {
  const { user } = useAuth()
  const [releases, setReleases] = useState<ContentRelease[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setReleases((await contentApi.listReleases()).releases) } catch (cause) { setError(messageFrom(cause)) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function rollback(version: string) {
    setBusy(version)
    try { await contentApi.rollback(version); await load() } catch (cause) { setError(messageFrom(cause)) } finally { setBusy(null) }
  }
  return (
    <section className="data-page">
      <header><div><small>IMMUTABLE RELEASES</small><h1>发布版本</h1><p>已发布内容不会被原地覆盖；回滚只切换新房间的激活版本。</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw />刷新</button></header>
      {error ? <div className="notice-banner is-error"><AlertCircle />{error}</div> : null}
      <div className="data-table" role="table" aria-label="发布版本">
        <div className="data-row data-head" role="row"><span>内容</span><span>版本</span><span>修订</span><span>发布时间</span><span>状态</span><span>操作</span></div>
        {releases.map((release) => <div className="data-row" role="row" key={release.version}><strong>{release.contentKey}</strong><code>{release.version}</code><span>r{release.revision}</span><span>{formatTime(release.publishedAt)}</span><span className={release.active ? 'active-release' : ''}>{release.active ? '当前激活' : '历史版本'}</span><span>{user?.role === 'admin' && !release.active ? <button type="button" title="回滚到此版本" aria-label={`回滚 ${release.version}`} disabled={busy === release.version} onClick={() => void rollback(release.version)}><ArchiveRestore /></button> : '—'}</span></div>)}
        {releases.length === 0 ? <div className="empty-table">暂无发布版本</div> : null}
      </div>
    </section>
  )
}

export function AuditPage() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (user?.role !== 'admin') return
    try { setEntries((await contentApi.listAudit()).audit) } catch (cause) { setError(messageFrom(cause)) }
  }, [user?.role])
  useEffect(() => { void load() }, [load])
  if (user?.role !== 'admin') return <div className="workspace-empty"><ShieldCheck /><strong>仅管理员可查看审计记录</strong></div>
  return (
    <section className="data-page">
      <header><div><small>APPEND-ONLY AUDIT</small><h1>操作审计</h1><p>发布、回滚和内容状态变更的不可删除记录。</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw />刷新</button></header>
      {error ? <div className="notice-banner is-error"><AlertCircle />{error}</div> : null}
      <div className="data-table audit-table" role="table" aria-label="操作审计">
        <div className="data-row data-head" role="row"><span>时间</span><span>操作</span><span>对象</span><span>操作者</span></div>
        {entries.map((entry) => <div className="data-row" role="row" key={entry.id}><span>{formatTime(entry.createdAt)}</span><strong>{actionLabels[entry.action] ?? entry.action}</strong><code>{entry.entityType}:{entry.entityId}</code><span>{entry.actorId}</span></div>)}
        {entries.length === 0 ? <div className="empty-table">暂无审计记录</div> : null}
      </div>
    </section>
  )
}
