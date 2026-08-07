import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, FileImage, FilePlus2, Palette, RefreshCw, Save, Send, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, contentApi } from './api'
import { useAuth } from './auth-context'
import type { ContentDraft, DraftStatus, ManagedSkinContent } from './types'
import './skin-styles.css'

const statusLabels: Record<DraftStatus, string> = {
  draft: '草稿',
  'in-review': '待审核',
  approved: '已通过',
  rejected: '已驳回',
  published: '已发布',
}

function messageFrom(cause: unknown) {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : '内容服务请求失败。'
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function skinFromUnknown(value: unknown): ManagedSkinContent | null {
  if (!value || typeof value !== 'object') return null
  const skin = value as Partial<ManagedSkinContent>
  return typeof skin.id === 'string' && typeof skin.name === 'string' && typeof skin.atlas === 'string' && skin.production
    ? skin as ManagedSkinContent
    : null
}

function SkinDraftList({ drafts, selectedId, loading, onRefresh }: { readonly drafts: readonly ContentDraft[]; readonly selectedId?: string; readonly loading: boolean; readonly onRefresh: () => void }) {
  const navigate = useNavigate()
  return (
    <aside className="draft-browser" aria-label="皮肤草稿">
      <div className="panel-heading">
        <div><small>SKIN DRAFTS</small><strong>皮肤草稿</strong></div>
        <button type="button" title="刷新草稿" aria-label="刷新皮肤草稿" onClick={onRefresh}><RefreshCw className={loading ? 'is-spinning' : ''} /></button>
      </div>
      <button className="new-draft-button" type="button" onClick={() => navigate('/skins/new')}><FilePlus2 />新建皮肤</button>
      <div className="draft-list">
        {drafts.length === 0 && !loading ? <div className="empty-list"><span className="empty-mark">肤</span><strong>还没有皮肤草稿</strong><span>上传透明棋子原图开始制作</span></div> : null}
        {drafts.map((draft) => (
          <button type="button" className={draft.id === selectedId ? 'draft-row is-selected' : 'draft-row'} onClick={() => navigate(`/skins/${draft.id}`)} key={draft.id}>
            <span className={`status-dot status-${draft.status}`} />
            <span className="draft-row-copy"><strong>{draft.title}</strong><small>修订 {draft.currentRevision} · {formatTime(draft.updatedAt)}</small></span>
            <span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span>
            <ChevronRight />
          </button>
        ))}
      </div>
    </aside>
  )
}

function NewSkin({ onCreated }: { readonly onCreated: (draft: ContentDraft) => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!file || !name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const processed = await contentApi.processSkin(name.trim(), file)
      const result = await contentApi.createSkin(name.trim(), processed.skin)
      onCreated(result.draft)
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
    setError(null)
  }

  return (
    <section className="skin-new-panel">
      <div className="skin-new-copy"><small>NEW TOKEN SKIN</small><h1>制作棋子皮肤</h1><p>上传一张主体完整的 PNG、JPEG 或 WebP。系统会统一画布、锚点、阴影和缩略图。</p></div>
      <div className="skin-upload-form">
        <label><span>展示名</span><input value={name} maxLength={40} placeholder="例如 港口巡游鹅" onChange={(event) => setName(event.target.value)} /></label>
        <label className="skin-file-picker">
          <FileImage />
          <span>{file ? file.name : '选择 PNG、JPEG 或 WebP 原图'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} />
        </label>
        {error ? <div className="notice-banner is-error" role="alert"><AlertCircle />{error}</div> : null}
        <button className="primary-button" type="button" disabled={!file || !name.trim() || busy} onClick={() => void create()}><Upload />{busy ? '正在处理' : '处理并创建草稿'}</button>
      </div>
      <div className="skin-upload-requirements">
        <strong>上传门禁</strong>
        <span>原图 256–4096 px，文件不超过 5 MB</span>
        <span>主体四周保留透明边距，不接受贴边裁切</span>
        <span>纯色背景会尝试自动移除，复杂背景会停止并给出修正原因</span>
      </div>
    </section>
  )
}

function SkinPreviews({ skin }: { readonly skin: ManagedSkinContent }) {
  return (
    <section className="skin-preview-section" aria-label="皮肤使用场景预览">
      <header><small>RUNTIME PREVIEW</small><h2>游戏内预览</h2></header>
      <div className="skin-preview-grid">
        <article className="skin-preview hud-preview"><span><img src={skin.production.thumbnail} alt="" /></span><div><strong>玩家昵称</strong><small>桌面 HUD</small></div></article>
        <article className="skin-preview profile-preview"><img src={skin.atlas} alt={`${skin.name}准备页预览`} /><strong>{skin.name}</strong><small>准备页</small></article>
        <article className="skin-preview board-preview"><span className="preview-shadow" /><img src={skin.atlas} alt={`${skin.name}棋盘预览`} /><small>棋盘落点</small></article>
        <article className="skin-preview target-preview"><strong>选择目标</strong><img src={skin.atlas} alt={`${skin.name}目标卡预览`} /><span>第 18 格</span></article>
      </div>
    </section>
  )
}

function SkinDraftEditor({ draft, onChange, onDeleted }: { readonly draft: ContentDraft; readonly onChange: (draft: ContentDraft) => void; readonly onDeleted: () => void }) {
  const skin = skinFromUnknown(draft.content)
  const [name, setName] = useState(skin?.name ?? draft.title)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const editable = draft.status === 'draft' || draft.status === 'rejected'

  useEffect(() => setName(skin?.name ?? draft.title), [draft.id, draft.currentRevision, draft.title, skin?.name])
  if (!skin) return <div className="workspace-empty"><AlertCircle /><strong>皮肤草稿数据无法读取</strong></div>

  async function run(operation: () => Promise<{ draft: ContentDraft }>, success: string) {
    setBusy(true); setError(null); setNotice(null)
    try { const result = await operation(); onChange(result.draft); setNotice(success) } catch (cause) { setError(messageFrom(cause)) } finally { setBusy(false) }
  }
  async function save() {
    const next: ManagedSkinContent = { ...skin!, name: name.trim(), title: name.trim() }
    await run(() => contentApi.updateSkin(draft.id, draft.currentRevision, name.trim(), next), '皮肤修订已保存并完成自动校验。')
  }
  async function remove() {
    if (!window.confirm(`确定删除皮肤草稿“${draft.title}”吗？`)) return
    setBusy(true); setError(null)
    try { await contentApi.deleteDraft(draft.id); onDeleted() } catch (cause) { setError(messageFrom(cause)) } finally { setBusy(false) }
  }

  return (
    <section className="skin-editor-panel">
      <header className="editor-toolbar">
        <div><small>{draft.contentKey}</small><strong>{draft.title}</strong></div>
        <div className="toolbar-meta"><span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span><span>修订 {draft.currentRevision}</span></div>
        <div className="toolbar-actions">
          {editable ? <button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => void save()}><Save />保存修订</button> : null}
          {editable ? <button className="secondary-button" type="button" disabled={busy || !draft.validation.valid} onClick={() => void run(() => contentApi.submitDraft(draft.id), '已提交审核。')}><Send />提交审核</button> : null}
          {draft.status === 'in-review' ? <button className="secondary-button success-button" type="button" disabled={busy} onClick={() => void run(() => contentApi.reviewDraft(draft.id, 'approve'), '审核已通过。')}><ShieldCheck />通过</button> : null}
          {draft.status === 'in-review' ? <button className="secondary-button danger-button" type="button" disabled={busy || !reason.trim()} onClick={() => void run(() => contentApi.reviewDraft(draft.id, 'reject', reason), '草稿已驳回。')}><AlertCircle />驳回</button> : null}
          {draft.status === 'approved' ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run(async () => { await contentApi.publishDraft(draft.id); return contentApi.getDraft(draft.id) }, '皮肤版本已发布。')}><CheckCircle2 />发布</button> : null}
        </div>
      </header>
      {draft.status === 'in-review' ? <label className="review-reason"><span>驳回原因</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
      {error ? <div className="notice-banner is-error" role="alert"><AlertCircle />{error}</div> : null}
      {notice ? <div className="notice-banner is-success" role="status"><CheckCircle2 />{notice}</div> : null}
      <div className="skin-editor-scroll">
        <section className="skin-definition-form">
          <div><small>SKIN DEFINITION</small><h2>皮肤定义</h2></div>
          <label><span>稳定 Skin ID</span><input value={skin.id} disabled /></label>
          <label><span>展示名</span><input value={name} maxLength={40} disabled={!editable} onChange={(event) => setName(event.target.value)} /></label>
          <dl><div><dt>原图</dt><dd>{skin.production.sourceWidth} × {skin.production.sourceHeight}</dd></div><div><dt>有效主体</dt><dd>{skin.production.subjectWidth} × {skin.production.subjectHeight}</dd></div><div><dt>锚点</dt><dd>{skin.anchor.x}, {skin.anchor.y}</dd></div><div><dt>透明区域</dt><dd>{Math.round(skin.production.transparentPixelRatio * 100)}%</dd></div></dl>
        </section>
        <SkinPreviews skin={skin} />
        {!draft.validation.valid ? <section className="validation-panel"><div><AlertCircle /><strong>自动校验未通过</strong></div>{draft.validation.issues.map((issue) => <p key={`${issue.path}-${issue.code}`}><code>{issue.path || 'content'}</code>{issue.message}</p>)}</section> : null}
        {editable ? <button className="skin-delete-button" type="button" disabled={busy} onClick={() => void remove()}><Trash2 />删除皮肤草稿</button> : null}
      </div>
    </section>
  )
}

export function SkinWorkspace() {
  const { user } = useAuth()
  const { draftId } = useParams()
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [active, setActive] = useState<ContentDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const skinDrafts = useMemo(() => drafts.filter((draft) => draft.kind === 'skin'), [drafts])
  const loadDrafts = useCallback(async () => {
    setLoading(true); setError(null)
    try { const result = await contentApi.listDrafts(); setDrafts(result.drafts) } catch (cause) { setError(messageFrom(cause)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (user?.role === 'admin') void loadDrafts() }, [loadDrafts, user?.role])
  useEffect(() => {
    if (!draftId || draftId === 'new' || user?.role !== 'admin') { setActive(null); return }
    setLoading(true); setError(null)
    void contentApi.getDraft(draftId).then((result) => setActive(result.draft)).catch((cause) => setError(messageFrom(cause))).finally(() => setLoading(false))
  }, [draftId, user?.role])
  if (user?.role !== 'admin') return <div className="workspace-empty"><ShieldCheck /><strong>仅管理员可以制作棋子皮肤</strong></div>
  return (
    <div className="skin-workspace">
      <SkinDraftList drafts={skinDrafts} selectedId={active?.id} loading={loading} onRefresh={() => void loadDrafts()} />
      {error ? <div className="workspace-empty"><AlertCircle /><strong>{error}</strong></div>
        : draftId === 'new' ? <NewSkin onCreated={(draft) => { setActive(draft); void loadDrafts(); navigate(`/skins/${draft.id}`) }} />
          : active ? <SkinDraftEditor draft={active} onChange={(draft) => { setActive(draft); void loadDrafts() }} onDeleted={() => { setActive(null); void loadDrafts(); navigate('/skins') }} />
            : <div className="workspace-empty"><Palette /><strong>选择或创建皮肤草稿</strong><p>上传透明原图，系统会生成统一的游戏内棋子资源。</p><button className="primary-button" type="button" onClick={() => navigate('/skins/new')}><FilePlus2 />新建皮肤</button></div>}
    </div>
  )
}
