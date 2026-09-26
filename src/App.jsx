import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Boxes, Check, ChevronDown, CircleAlert, ClipboardList, Clock3, LogOut, Menu, Package, Plus, Search, Settings, ShieldCheck, Sparkles, UserRound, Warehouse, X } from 'lucide-react'
import { api, jsonBody, listFrom } from './lib/api.js'
import { supabase } from './lib/supabase.js'

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: Activity },
  { label: 'Products', to: '/products', icon: Package },
  { label: 'Receipts', to: '/operations/receipts', icon: ArrowDownToLine, group: 'OPERATIONS' },
  { label: 'Deliveries', to: '/operations/deliveries', icon: ArrowUpFromLine },
  { label: 'Transfers', to: '/operations/transfers', icon: ArrowLeftRight },
  { label: 'Adjustments', to: '/operations/adjustments', icon: ClipboardList },
  { label: 'Move history', to: '/history', icon: Clock3 },
  { label: 'AI Agent', to: '/ai', icon: Sparkles },
  { label: 'Warehouses', to: '/settings/warehouse', icon: Warehouse, group: 'SETTINGS' },
  { label: 'My profile', to: '/profile', icon: UserRound },
]

const titles = {
  '/dashboard': ['Inventory overview', 'A live view of stock and open movement documents.'],
  '/products': ['Products', 'Manage your catalog, units, and replenishment thresholds.'],
  '/operations/receipts': ['Receipts', 'Record incoming stock and validate it into a location.'],
  '/operations/deliveries': ['Deliveries', 'Pick, pack, and validate outgoing stock.'],
  '/operations/transfers': ['Internal transfers', 'Move stock between locations without changing company totals.'],
  '/operations/adjustments': ['Adjustments', 'Reconcile recorded quantities against a physical count.'],
  '/history': ['Move history', 'Every validated stock change, with before-and-after quantities.'],
  '/ai': ['StockSense AI', 'Evidence-backed inventory answers with human-approved actions.'],
  '/settings/warehouse': ['Warehouses & locations', 'Review the active storage structure.'],
  '/profile': ['My profile', 'Account details and session controls.'],
}

function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return undefined
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])

  const refresh = () => setRevision((value) => value + 1)
  return <BrowserRouter><Routes>
    <Route path="/login" element={<AuthPage mode="login" session={session} />} />
    <Route path="/signup" element={<AuthPage mode="signup" session={session} />} />
    <Route path="/forgot-password" element={<AuthPage mode="recovery" session={session} />} />
    <Route element={<Protected loading={authLoading} session={session}><AppLayout session={session} /></Protected>}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard revision={revision} />} />
      <Route path="/products" element={<Products revision={revision} refresh={refresh} />} />
      <Route path="/operations/receipts" element={<OperationPage kind="RECEIPT" revision={revision} refresh={refresh} />} />
      <Route path="/operations/deliveries" element={<OperationPage kind="DELIVERY" revision={revision} refresh={refresh} />} />
      <Route path="/operations/transfers" element={<OperationPage kind="TRANSFER" revision={revision} refresh={refresh} />} />
      <Route path="/operations/adjustments" element={<OperationPage kind="ADJUSTMENT" revision={revision} refresh={refresh} />} />
      <Route path="/history" element={<History revision={revision} />} />
      <Route path="/ai" element={<AIAgent refresh={refresh} />} />
      <Route path="/settings/warehouse" element={<WarehouseSettings />} />
      <Route path="/profile" element={<Profile session={session} />} />
    </Route>
    <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
  </Routes></BrowserRouter>
}

function Protected({ loading, session, children }) {
  const location = useLocation()
  if (loading) return <div className="screen-loading"><span className="spinner" />Loading session…</div>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return children
}

function AppLayout({ session }) {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [apiState, setApiState] = useState('checking')
  const name = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Account'
  const title = titles[location.pathname] || titles['/dashboard']
  useEffect(() => { api('/api/health').then((result) => setApiState(result?.ok ? 'online' : 'offline')).catch(() => setApiState('offline')) }, [])
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <NavLink to="/dashboard" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><Boxes size={19} /></span><span>stock<span className="brand-accent">sense</span></span><span className="brand-version">OPS</span></NavLink>
      <div className="workspace-switch"><span className="workspace-dot" /><span><b>Northstar Supply</b><small>Inventory workspace</small></span><ChevronDown size={15} /></div>
      <nav className="side-nav">{navItems.map((item) => <div key={item.to}>{item.group && <div className="nav-group-label">{item.group}</div>}<NavLink to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.label === 'AI Agent' && <span className="nav-new">AI</span>}</NavLink></div>)}</nav>
      <div className="sidebar-bottom"><div className="connection-state"><span className={`live-dot ${apiState === 'offline' ? 'api-down' : ''}`} /><span>{apiState === 'checking' ? 'Checking API…' : apiState === 'online' ? 'API online' : 'API unavailable'}</span></div><button className="nav-link logout-link" onClick={() => supabase?.auth.signOut()}><LogOut size={17} /><span>Log out</span></button></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={19} /></button><div className="breadcrumbs">STOCKSENSE <span>/</span> {title[0].toUpperCase()}</div><div className="topbar-right"><span className="topbar-date">Live inventory</span><div className="avatar">{name.slice(0, 1).toUpperCase()}</div><span className="topbar-name">{name}</span></div></header>
      <div className="page-content"><Outlet /></div>
    </main>
  </div>
}

function PageHeading({ title, subtitle, action }) {
  return <div className="page-heading"><div><div className="eyebrow">INVENTORY CONTROL</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}

function FilterBar({ children, count }) {
  return <div className="toolbar">{children}<span className="result-count">{count}</span></div>
}

function ErrorMessage({ children }) {
  if (!children) return null
  return <div className="error-banner"><CircleAlert size={17} /><span>{children}</span></div>
}

function Empty({ title = 'Nothing to show yet', text = 'When data is available, it will appear here.' }) {
  return <div className="empty-state"><span className="empty-icon"><Package size={20} /></span><b>{title}</b><span>{text}</span></div>
}

function Spinner() { return <span className="spinner" /> }

function AuthPage({ mode, session }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stage, setStage] = useState('email')
  const [form, setForm] = useState({ name: '', email: '', password: '', token: '', nextPassword: '' })
  useEffect(() => { if (session && mode !== 'recovery') navigate('/dashboard', { replace: true }) }, [session, mode, navigate])
  const change = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }))
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      if (!supabase) throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local to enable authentication.')
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
        if (authError) throw authError
        navigate('/dashboard', { replace: true })
      } else if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.name } } })
        if (authError) throw authError
        if (data.session) navigate('/dashboard', { replace: true })
        else setNotice('Check your email to confirm your account, then sign in.')
      } else if (stage === 'email') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(form.email)
        if (authError) throw authError
        setStage('otp'); setNotice('A recovery code has been sent. Enter the code from your email.')
      } else {
        const { error: verifyError } = await supabase.auth.verifyOtp({ email: form.email, token: form.token, type: 'recovery' })
        if (verifyError) throw verifyError
        const { error: updateError } = await supabase.auth.updateUser({ password: form.nextPassword })
        if (updateError) throw updateError
        setNotice('Password updated. You can now sign in.')
        navigate('/login', { replace: true })
      }
    } catch (cause) { setError(cause.message || 'Authentication failed.') }
    finally { setBusy(false) }
  }
  const recovery = mode === 'recovery'
  const heading = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'
  return <div className="auth-screen"><div className="auth-art"><div className="auth-brand"><span className="brand-mark"><Boxes size={19} /></span>stocksense</div><div className="auth-message"><span className="eyebrow light">INVENTORY, IN FOCUS</span><h1>Know what<br />moves next.</h1><p>Clear stock visibility. Confident decisions. One dependable source of truth.</p><div className="auth-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><Boxes size={31} /></div><span className="orbit-tag tag-a">LIVE STOCK</span><span className="orbit-tag tag-b">AI INSIGHTS</span><span className="orbit-tag tag-c">MOVEMENT</span></div></div><div className="auth-art-footer">STOCKSENSE / INVENTORY OPERATIONS</div></div><div className="auth-form-wrap"><div className="auth-form-box"><div className="eyebrow">SECURE WORKSPACE</div><h2>{heading}</h2><p className="auth-intro">{mode === 'login' ? 'Sign in to continue to your inventory.' : mode === 'signup' ? 'Set up access to your StockSense workspace.' : 'We’ll send a one-time recovery code to your email.'}</p><ErrorMessage>{error}</ErrorMessage>{notice && <div className="success-banner"><Check size={16} />{notice}</div>}<form onSubmit={submit} className="form-stack">
    {mode === 'signup' && <Field label="Full name"><input autoComplete="name" value={form.name} onChange={change('name')} required /></Field>}
    <Field label="Email address"><input type="email" autoComplete="email" value={form.email} onChange={change('email')} required /></Field>
    {mode === 'login' && <Field label="Password"><input type="password" autoComplete="current-password" value={form.password} onChange={change('password')} required /></Field>}
    {mode === 'signup' && <Field label="Password"><input type="password" autoComplete="new-password" minLength="8" value={form.password} onChange={change('password')} required /></Field>}
    {recovery && stage === 'otp' && <><Field label="Email code"><input inputMode="numeric" value={form.token} onChange={change('token')} required /></Field><Field label="New password"><input type="password" autoComplete="new-password" minLength="8" value={form.nextPassword} onChange={change('nextPassword')} required /></Field></>}
    <button className="button button-primary button-full" disabled={busy}>{busy ? <><Spinner />Working…</> : recovery ? stage === 'email' ? 'Send recovery code' : 'Verify code & update password' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
  </form><div className="auth-links">{mode === 'login' ? <><NavLink to="/forgot-password">Forgot password?</NavLink><span>New to StockSense? <NavLink to="/signup">Create account</NavLink></span></> : <span><NavLink to="/login">Return to sign in</NavLink></span>}</div><div className="auth-security"><ShieldCheck size={15} /> Protected with Supabase Auth</div></div></div></div>
}

function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Dashboard({ revision }) {
  const [data, setData] = useState(null); const [riskProducts, setRiskProducts] = useState([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; setLoading(true); Promise.allSettled([api('/api/dashboard'), api('/api/products?lowStock=true')]).then(([dashboardResult, riskResult]) => { if (!active) return; if (dashboardResult.status === 'rejected') throw dashboardResult.reason; setData(dashboardResult.value); if (riskResult.status === 'fulfilled') setRiskProducts(listFrom(riskResult.value, 'products')); else setError(`Low-stock risks could not load: ${riskResult.reason.message}`) }).catch((cause) => { if (active) setError(cause.message) }).finally(() => active && setLoading(false)); return () => { active = false } }, [revision])
  const cards = [
    ['Total products in stock', data?.totalProducts, Package, 'neutral'],
    ['Low stock', data?.lowStockCount, CircleAlert, 'warning'],
    ['Out of stock', data?.outOfStockCount, CircleAlert, 'danger'],
    ['Pending receipts', data?.pendingReceipts, ArrowDownToLine, 'blue'],
    ['Pending deliveries', data?.pendingDeliveries, ArrowUpFromLine, 'blue'],
    ['Scheduled transfers', data?.scheduledTransfers, ArrowLeftRight, 'neutral'],
  ]
  return <><PageHeading title="Inventory overview" subtitle="A live view of stock and open movement documents." action={<span className="live-pill"><span className="live-dot" /> LIVE DATA</span>} /><ErrorMessage>{error}</ErrorMessage><div className="stat-grid">{cards.map(([label, value, Icon, color]) => <div className={`stat-card stat-${color}`} key={label}><div className="stat-top"><span>{label}</span><Icon size={17} /></div><strong>{loading ? <span className="skeleton" /> : value ?? '—'}</strong><span className="stat-caption">{label === 'Total products in stock' ? 'Unique products with stock' : label.includes('stock') ? 'Based on reorder levels' : 'Documents awaiting completion'}</span></div>)}</div><div className="dashboard-lower"><section className="panel overview-panel"><div className="panel-heading"><div><span className="eyebrow">WORKSPACE</span><h2>Operations at a glance</h2></div><span className="panel-icon"><Activity size={18} /></span></div><div className="quick-links">{navItems.slice(1, 6).map((item) => <NavLink key={item.to} to={item.to}><span className="quick-icon"><item.icon size={17} /></span><span><b>{item.label}</b><small>Open {item.label.toLowerCase()}</small></span><span className="quick-arrow">↗</span></NavLink>)}</div></section><section className="ai-promo"><div className="promo-eyebrow"><Sparkles size={15} /> INTELLIGENCE LAYER</div><div className="insight-links"><NavLink to={`/ai?question=${encodeURIComponent('What products are at stockout risk?')}`}><span><b>Stockout risks</b><small>{loading ? 'Checking live stock…' : riskProducts.length ? riskProducts.slice(0, 2).map((item) => item.name).join(', ') : 'No low-stock products reported'}</small></span><strong>{loading ? '—' : riskProducts.length}</strong></NavLink><NavLink to={`/ai?question=${encodeURIComponent('Why is there a stock discrepancy?')}`}><span><b>Discrepancies</b><small>Investigate a stock variance</small></span><span className="insight-arrow">↗</span></NavLink><NavLink to={`/ai?question=${encodeURIComponent('What action do you recommend?')}`}><span><b>Recommendations</b><small>Review evidence-backed actions</small></span><span className="insight-arrow">↗</span></NavLink></div><div className="promo-watermark"><Sparkles size={90} strokeWidth={0.8} /></div></section></div></>
}

function Products({ revision, refresh }) {
  const [products, setProducts] = useState([]); const [locations, setLocations] = useState([]); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [editing, setEditing] = useState(null); const [saving, setSaving] = useState(false)
  useEffect(() => { let active = true; setLoading(true); const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); Promise.all([api(`/api/products${params.size ? `?${params}` : ''}`), api('/api/locations')]).then(([data, locationData]) => { if (!active) return; setProducts(listFrom(data, 'products')); setLocations(listFrom(locationData, 'locations')) }).catch((cause) => active && setError(cause.message)).finally(() => active && setLoading(false)); return () => { active = false } }, [query, revision])
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('')
    const fields = new FormData(event.currentTarget)
    const body = { name: fields.get('name'), sku: fields.get('sku'), categoryId: fields.get('categoryId') || null, unit: fields.get('unit'), reorderLevel: Number(fields.get('reorderLevel') || 0) }
    if (!editing?.id) Object.assign(body, { initialStock: Number(fields.get('initialStock') || 0), locationId: fields.get('locationId') || null })
    try { await api(editing?.id ? `/api/products/${editing.id}` : '/api/products', { method: editing?.id ? 'PUT' : 'POST', body: jsonBody(body) }); setEditing(null); refresh(); }
    catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }
  const stock = (product) => Number(product.quantity ?? product.totalStock ?? product.stock ?? 0)
  return <><PageHeading title="Products" subtitle="Manage your catalog, units, and replenishment thresholds." action={<button className="button button-primary" onClick={() => setEditing({})}><Plus size={16} /> Add product</button>} /><ErrorMessage>{error}</ErrorMessage><FilterBar count={loading ? 'Loading…' : `${products.length} products`}><label className="search-box"><Search size={17} /><input placeholder="Search name or SKU" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label></FilterBar><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>LOCATION</th><th>ON HAND</th><th>REORDER AT</th><th>STATUS</th><th /></tr></thead><tbody>{!loading && products.map((product) => { const quantity = stock(product); const threshold = Number(product.reorder_level ?? product.reorderLevel ?? 0); const state = quantity <= 0 ? 'Out of stock' : quantity <= threshold ? 'Low stock' : 'Healthy'; return <tr key={product.id}><td><div className="product-cell"><span className="product-thumb"><Package size={17} /></span><b>{product.name}</b></div></td><td className="mono">{product.sku}</td><td>{product.category?.name || product.categoryName || product.category_id || '—'}</td><td>{product.location?.name || product.locationName || '—'}</td><td><b>{quantity.toLocaleString()} {product.unit}</b></td><td>{threshold} {product.unit}</td><td><StatusBadge value={state} /></td><td><button className="text-button" onClick={() => setEditing(product)}>Edit</button></td></tr>})}</tbody></table>{loading && <div className="table-loading"><Spinner /> Loading products…</div>}{!loading && !products.length && <Empty title="No products found" text={query ? 'Try a different product name or SKU.' : 'Add your first product to start tracking stock.'} />}</div>{editing && <Modal title={editing.id ? 'Update product' : 'New product'} close={() => setEditing(null)}><form className="form-stack" onSubmit={save}><div className="field-grid"><Field label="Product name"><input name="name" defaultValue={editing.name || ''} required /></Field><Field label="SKU / code"><input name="sku" defaultValue={editing.sku || ''} required /></Field><Field label="Category ID"><input name="categoryId" defaultValue={editing.category_id || editing.categoryId || ''} /></Field><Field label="Unit of measure"><input name="unit" defaultValue={editing.unit || 'each'} required /></Field><Field label="Reorder level"><input name="reorderLevel" type="number" min="0" step="any" defaultValue={editing.reorder_level ?? editing.reorderLevel ?? 0} required /></Field>{!editing.id && <><Field label="Initial stock"><input name="initialStock" type="number" min="0" step="any" defaultValue="0" required /></Field><Field label="Initial location"><select name="locationId"><option value="">No location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></Field></>}</div><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setEditing(null)}>Cancel</button><button disabled={saving} className="button button-primary">{saving ? <><Spinner />Saving…</> : 'Save product'}</button></div></form></Modal>}</>
}

const operationMeta = {
  RECEIPT: { title: 'Receipts', subtitle: 'Record incoming stock and validate it into a location.', endpoint: '/api/operations/receipts', label: 'New receipt', Icon: ArrowDownToLine, party: 'Supplier', locLabel: 'Destination location' },
  DELIVERY: { title: 'Deliveries', subtitle: 'Pick, pack, and validate outgoing stock.', endpoint: '/api/operations/deliveries', label: 'New delivery', Icon: ArrowUpFromLine, party: 'Customer', locLabel: 'Source location' },
  TRANSFER: { title: 'Internal transfers', subtitle: 'Move stock between locations without changing company totals.', endpoint: '/api/operations/transfers', label: 'New transfer', Icon: ArrowLeftRight },
  ADJUSTMENT: { title: 'Adjustments', subtitle: 'Reconcile recorded quantities against a physical count.', endpoint: '/api/operations/adjustments', label: 'New adjustment', Icon: ClipboardList },
}

function OperationPage({ kind, revision, refresh }) {
  const config = operationMeta[kind]; const [operations, setOperations] = useState([]); const [products, setProducts] = useState([]); const [locations, setLocations] = useState([]); const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [modal, setModal] = useState(false); const [saving, setSaving] = useState(false); const [draft, setDraft] = useState(null); const [status, setStatus] = useState(''); const [warehouseId, setWarehouseId] = useState(''); const [categoryId, setCategoryId] = useState(''); const [search, setSearch] = useState(''); const [lineCount, setLineCount] = useState(1)
  useEffect(() => { let active = true; setLoading(true); const params = new URLSearchParams({ type: kind }); if (status) params.set('status', status); if (warehouseId) params.set('warehouseId', warehouseId); if (categoryId) params.set('categoryId', categoryId); if (search.trim()) params.set('search', search.trim()); Promise.all([api(`/api/operations?${params}`), api('/api/products'), api('/api/warehouses'), api('/api/locations')]).then(([ops, prods, whs, locs]) => { if (!active) return; setOperations(listFrom(ops, 'operations')); setProducts(listFrom(prods, 'products')); setWarehouses(listFrom(whs, 'warehouses')); setLocations(listFrom(locs, 'locations')) }).catch((cause) => active && setError(cause.message)).finally(() => active && setLoading(false)); return () => { active = false } }, [kind, revision, status, warehouseId, categoryId, search])
  const categories = [...new Map(products.map((item) => { const id = item.category_id || item.categoryId; return id ? [id, item.category?.name || item.categoryName || id] : null }).filter(Boolean)).entries()]
  async function create(event) {
    event.preventDefault(); setSaving(true); setError('')
    const fields = new FormData(event.currentTarget)
    const items = [...event.currentTarget.querySelectorAll('[data-line]')].map((line) => ({ productId: line.querySelector('[name="productId"]').value, [kind === 'ADJUSTMENT' ? 'countedQuantity' : 'quantity']: Number(line.querySelector('[name="quantity"]').value) }))
    const body = { items }
    if (kind === 'RECEIPT') Object.assign(body, { supplier: fields.get('party'), destinationLocationId: fields.get('destinationLocationId') })
    if (kind === 'DELIVERY') Object.assign(body, { customer: fields.get('party'), sourceLocationId: fields.get('sourceLocationId') })
    if (kind === 'TRANSFER') Object.assign(body, { sourceLocationId: fields.get('sourceLocationId'), destinationLocationId: fields.get('destinationLocationId') })
    if (kind === 'ADJUSTMENT') body.locationId = fields.get('locationId')
    try { const result = await api(config.endpoint, { method: 'POST', body: jsonBody(body) }); const id = result?.id || result?.operationId || result?.operation?.id; setDraft(id ? { id, kind } : null); setModal(false); if (id) setError(''); else setError('Operation created, but the API response did not include an operation ID. Validation is unavailable until the backend returns id or operationId.'); refresh() }
    catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }
  async function validate(id) {
    setSaving(true); setError('')
    try { await api(`/api/operations/${id}/validate`, { method: 'POST' }); setDraft(null); refresh() } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }
  return <><PageHeading title={config.title} subtitle={config.subtitle} action={<button className="button button-primary" onClick={() => { setLineCount(1); setModal(true) }}><Plus size={16} /> {config.label}</button>} /><ErrorMessage>{error}</ErrorMessage><FilterBar count={`${operations.length} documents`}><label className="search-box"><Search size={16} /><input placeholder="Search product or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="filter-select">Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['DRAFT', 'WAITING', 'READY', 'DONE', 'CANCELED'].map((value) => <option key={value}>{value}</option>)}</select></label><label className="filter-select">Warehouse <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">All warehouses</option>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="filter-select">Category <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">All categories</option>{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></FilterBar>{draft && <div className="draft-callout"><div><b>Draft operation created</b><span>Reference {draft.id}</span></div><button className="button button-primary" disabled={saving} onClick={() => validate(draft.id)}><Check size={16} /> Validate</button></div>}<div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>TYPE</th><th>PARTNER / ROUTE</th><th>STATUS</th><th>CREATED</th><th /></tr></thead><tbody>{!loading && operations.map((operation) => <tr key={operation.id}><td className="mono">{operation.reference || operation.id}</td><td>{operation.type || kind}</td><td>{operation.supplier || operation.customer || [operation.source_location?.name, operation.destination_location?.name].filter(Boolean).join(' → ') || '—'}</td><td><StatusBadge value={operation.status} /></td><td>{formatDate(operation.created_at)}</td><td>{operation.status !== 'DONE' && operation.status !== 'CANCELED' && <button className="text-button" disabled={saving} onClick={() => validate(operation.id)}>Validate</button>}</td></tr>)}</tbody></table>{loading && <div className="table-loading"><Spinner /> Loading operations…</div>}{!loading && !operations.length && <Empty title="No operations yet" text="Create a document to record a stock movement." />}</div>{modal && <Modal title={config.label} close={() => setModal(false)}><form className="form-stack" onSubmit={create}><div className="field-grid">{(kind === 'RECEIPT' || kind === 'DELIVERY') && <Field label={config.party}><input name="party" required /></Field>}{kind === 'TRANSFER' && <Field label="Source location"><select name="sourceLocationId" required><option value="">Select location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></Field>}{kind === 'ADJUSTMENT' && <Field label="Count location"><select name="locationId" required><option value="">Select location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></Field>}{(kind === 'RECEIPT' || kind === 'TRANSFER') && <Field label={kind === 'TRANSFER' ? 'Destination location' : config.locLabel}><select name="destinationLocationId" required><option value="">Select location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></Field>}{kind === 'DELIVERY' && <Field label={config.locLabel}><select name="sourceLocationId" required><option value="">Select location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></Field>}</div><div className="line-items-heading"><b>Products</b><span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span></div>{Array.from({ length: lineCount }, (_, index) => <div className="line-item" data-line key={index}><Field label={`Product ${index + 1}`}><select name="productId" required><option value="">Select product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></Field><Field label={kind === 'ADJUSTMENT' ? 'Counted quantity' : 'Quantity'}><input name="quantity" type="number" min="0" step="any" required /></Field></div>)}<button type="button" className="text-button add-line-button" onClick={() => setLineCount((count) => count + 1)}><Plus size={14} /> Add product line</button><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(false)}>Cancel</button><button disabled={saving} className="button button-primary">{saving ? <><Spinner />Creating…</> : 'Create draft'}</button></div><p className="form-footnote">Stock changes only after the backend validates the operation.</p></form></Modal>}</>
}

function History({ revision }) {
  const [rows, setRows] = useState([]); const [locations, setLocations] = useState([]); const [products, setProducts] = useState([]); const [locationId, setLocationId] = useState(''); const [productId, setProductId] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { Promise.all([api('/api/locations'), api('/api/products')]).then(([locationData, productData]) => { setLocations(listFrom(locationData, 'locations')); setProducts(listFrom(productData, 'products')) }).catch(() => {}) }, [])
  useEffect(() => { let active = true; setLoading(true); const params = new URLSearchParams({ limit: '100' }); if (locationId) params.set('locationId', locationId); if (productId.trim()) params.set('productId', productId.trim()); api(`/api/ledger?${params}`).then((data) => active && setRows(listFrom(data, 'ledger'))).catch((cause) => active && setError(cause.message)).finally(() => active && setLoading(false)); return () => { active = false } }, [revision, locationId, productId])
  return <><PageHeading title="Move history" subtitle="Every validated stock change, with before-and-after quantities." /><ErrorMessage>{error}</ErrorMessage><FilterBar count={`Latest ${rows.length} movements`}><label className="filter-select">Product <select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">All products</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label className="filter-select">Location <select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></FilterBar><div className="table-wrap"><table><thead><tr><th>DATE</th><th>PRODUCT</th><th>MOVEMENT</th><th>CHANGE</th><th>LOCATION</th><th>BEFORE</th><th>AFTER</th><th>REFERENCE</th></tr></thead><tbody>{!loading && rows.map((row) => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td><b>{row.product?.name || row.product_name || row.product_id || '—'}</b></td><td><StatusBadge value={row.type} /></td><td className={Number(row.quantity_change) < 0 ? 'quantity-negative' : 'quantity-positive'}>{Number(row.quantity_change) > 0 ? '+' : ''}{row.quantity_change}</td><td>{row.location?.name || row.location_name || row.location_id || '—'}</td><td>{row.quantity_before}</td><td><b>{row.quantity_after}</b></td><td className="mono">{row.operation?.reference || row.operation_id || '—'}</td></tr>)}</tbody></table>{loading && <div className="table-loading"><Spinner /> Loading ledger…</div>}{!loading && !rows.length && <Empty title="No stock movements" text="Validated receipts, deliveries, transfers, and adjustments will be recorded here." />}</div></>
}

function AIAgent({ refresh }) {
  const location = useLocation()
  const [messages, setMessages] = useState([]); const [text, setText] = useState(() => new URLSearchParams(location.search).get('question') || ''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [deciding, setDeciding] = useState('')
  async function ask(event) {
    event.preventDefault(); if (!text.trim()) return
    const question = text.trim(); setText(''); setError(''); setMessages((items) => [...items, { role: 'user', message: question }]); setBusy(true)
    try { const result = await api('/api/agent/chat', { method: 'POST', body: jsonBody({ message: question }) }); setMessages((items) => [...items, { role: 'assistant', ...result }]) }
    catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  async function decide(recommendation, action) {
    if (!recommendation?.id) return
    setDeciding(`${recommendation.id}:${action}`); setError('')
    try { await api(`/api/agent/recommendations/${recommendation.id}/${action}`, { method: 'POST' }); setMessages((items) => items.map((item) => item.recommendation?.id === recommendation.id ? { ...item, recommendation: { ...item.recommendation, status: action === 'approve' ? 'APPROVED' : 'REJECTED' } } : item)); if (action === 'approve') refresh() }
    catch (cause) { setError(cause.message) } finally { setDeciding('') }
  }
  const suggestions = ['Why is stock at risk?', 'Show recent stock movements', 'Where is surplus stock?']
  return <><PageHeading title="StockSense AI" subtitle="Investigate inventory with evidence from your stock and ledger." action={<span className="ai-status"><span className="live-dot" /> EVIDENCE MODE</span>} /><ErrorMessage>{error}</ErrorMessage><div className="agent-layout"><section className="agent-chat"><div className="chat-head"><div className="agent-avatar"><Sparkles size={18} /></div><div><b>Inventory analyst</b><span>Grounded in live inventory records</span></div><span className="secure-tag"><ShieldCheck size={13} /> Evidence-backed</span></div><div className="chat-scroll">{messages.length === 0 ? <div className="chat-welcome"><div className="welcome-spark"><Sparkles size={23} /></div><span className="eyebrow">STOCKSENSE AGENT</span><h2>What do you need<br />to understand?</h2><p>Ask about on-hand stock, locations, stockout risk, or recent movements.</p><div className="suggestions">{suggestions.map((item) => <button key={item} onClick={() => setText(item)}>{item}<span>↗</span></button>)}</div></div> : messages.map((item, index) => <div className={`message message-${item.role}`} key={`${item.role}-${index}`}><div className="message-role">{item.role === 'user' ? 'YOU' : 'STOCKSENSE'}</div><p>{item.message}</p>{item.role === 'assistant' && <><EvidencePanel evidence={item.evidence} /><RecommendationCard recommendation={item.recommendation} deciding={deciding} onDecide={decide} /></>}</div>)}{busy && <div className="message message-assistant"><div className="message-role">STOCKSENSE</div><div className="thinking"><span /><span /><span /> Checking live records…</div></div>}</div><form className="chat-composer" onSubmit={ask}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask about a product, location, or movement…" rows="1" /><button className="send-button" disabled={busy || !text.trim()} aria-label="Send question"><span>↑</span></button><div className="composer-note"><ShieldCheck size={12} /> Stock figures and recommendations come from the backend.</div></form></section><aside className="agent-aside"><div className="aside-label">AGENT PRINCIPLES</div><div className="principle"><span className="principle-icon"><Activity size={16} /></span><div><b>Live inventory tools</b><p>Answers use backend stock and ledger data, not generated estimates.</p></div></div><div className="principle"><span className="principle-icon"><ClipboardList size={16} /></span><div><b>Traceable evidence</b><p>Relevant records accompany each inventory explanation.</p></div></div><div className="principle"><span className="principle-icon"><ShieldCheck size={16} /></span><div><b>Human approval</b><p>Any stock-changing recommendation must be approved by you.</p></div></div><div className="aside-footer">AI can assist with decisions. Inventory changes stay under your control.</div></aside></div></>
}

function EvidencePanel({ evidence }) {
  if (!Array.isArray(evidence) || !evidence.length) return null
  return <div className="evidence-panel"><div className="evidence-title"><Activity size={14} /> EVIDENCE <span>{evidence.length} records</span></div>{evidence.map((record, index) => <div className="evidence-row" key={record.id || index}><span className="evidence-dot" /><span>{record.description || record.title || record.type || record.productName || JSON.stringify(record)}</span><time>{formatDate(record.created_at || record.date)}</time></div>)}</div>
}

function RecommendationCard({ recommendation, deciding, onDecide }) {
  if (!recommendation) return null
  const done = recommendation.status === 'APPROVED' || recommendation.status === 'REJECTED'
  return <div className="recommendation-card"><div className="recommendation-label"><Sparkles size={14} /> RECOMMENDATION {recommendation.status && <StatusBadge value={recommendation.status} />}</div><p>{recommendation.recommendation || recommendation.type || 'Suggested inventory action'}</p>{recommendation.parameters && <pre>{JSON.stringify(recommendation.parameters, null, 2)}</pre>}{recommendation.requiresApproval && !done && <div className="recommendation-actions"><button className="button button-quiet" disabled={!recommendation.id || Boolean(deciding)} onClick={() => onDecide(recommendation, 'reject')}>Reject</button><button className="button button-primary" disabled={!recommendation.id || Boolean(deciding)} onClick={() => onDecide(recommendation, 'approve')}>{deciding ? <Spinner /> : <Check size={15} />} Approve</button></div>}{!recommendation.id && recommendation.requiresApproval && <small className="id-warning">Approval is unavailable because the chat response did not include a recommendation ID.</small>}</div>
}

function WarehouseSettings() {
  const [warehouses, setWarehouses] = useState([]); const [locations, setLocations] = useState([]); const [selected, setSelected] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; Promise.all([api('/api/warehouses'), api('/api/locations')]).then(([whs, locs]) => { if (!active) return; const list = listFrom(whs, 'warehouses'); setWarehouses(list); setLocations(listFrom(locs, 'locations')); setSelected(list[0]?.id || '') }).catch((cause) => active && setError(cause.message)).finally(() => active && setLoading(false)); return () => { active = false } }, [])
  const filtered = useMemo(() => selected ? locations.filter((location) => location.warehouse_id === selected || location.warehouseId === selected) : locations, [locations, selected])
  return <><PageHeading title="Warehouses & locations" subtitle="Review the active storage structure." /><ErrorMessage>{error}</ErrorMessage><div className="toolbar"><label className="filter-select">Warehouse <select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">All warehouses</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label><span className="result-count">{filtered.length} locations</span></div><div className="warehouse-grid">{warehouses.map((warehouse) => <button key={warehouse.id} className={`warehouse-card ${selected === warehouse.id ? 'selected' : ''}`} onClick={() => setSelected(warehouse.id)}><span className="warehouse-card-icon"><Warehouse size={20} /></span><span><b>{warehouse.name}</b><small>{warehouse.code || 'No code'} · {warehouse.address || 'Address not set'}</small></span><span className="warehouse-loc-count">{locations.filter((item) => item.warehouse_id === warehouse.id || item.warehouseId === warehouse.id).length}<small>LOCATIONS</small></span></button>)}</div><div className="section-heading"><h2>Locations</h2><span>{selected ? warehouses.find((item) => item.id === selected)?.name : 'All warehouses'}</span></div><div className="table-wrap"><table><thead><tr><th>LOCATION</th><th>CODE</th><th>WAREHOUSE</th></tr></thead><tbody>{!loading && filtered.map((item) => <tr key={item.id}><td><div className="product-cell"><span className="product-thumb"><Warehouse size={16} /></span><b>{item.name}</b></div></td><td className="mono">{item.code || '—'}</td><td>{warehouses.find((warehouse) => warehouse.id === (item.warehouse_id || item.warehouseId))?.name || '—'}</td></tr>)}</tbody></table>{loading && <div className="table-loading"><Spinner /> Loading locations…</div>}{!loading && !filtered.length && <Empty title="No locations found" />}</div></>
}

function Profile({ session }) {
  const [name, setName] = useState(session?.user?.user_metadata?.full_name || ''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false)
  async function save(event) { event.preventDefault(); if (!supabase) return; setBusy(true); setError(''); setSaved(false); const { error: updateError } = await supabase.auth.updateUser({ data: { full_name: name } }); if (updateError) setError(updateError.message); else setSaved(true); setBusy(false) }
  return <><PageHeading title="My profile" subtitle="Account details and session controls." /><ErrorMessage>{error}</ErrorMessage><section className="panel profile-panel"><div className="profile-summary"><div className="profile-avatar">{(name || session?.user?.email || 'A').slice(0, 1).toUpperCase()}</div><div><h2>{name || 'StockSense user'}</h2><p>{session?.user?.email}</p><StatusBadge value="Authenticated" /></div></div><form className="profile-form" onSubmit={save}><Field label="Full name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Email address"><input value={session?.user?.email || ''} readOnly /></Field>{saved && <div className="success-banner"><Check size={16} />Profile updated.</div>}<button className="button button-primary" disabled={busy}>{busy ? <><Spinner />Saving…</> : 'Save changes'}</button></form></section><button className="button button-danger-quiet" onClick={() => supabase?.auth.signOut()}><LogOut size={16} /> Log out</button></>
}

function Modal({ title, close, children }) {
  useEffect(() => { const listener = (event) => event.key === 'Escape' && close(); window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener) }, [close])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><span className="eyebrow">STOCK CONTROL</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label="Close"><X size={18} /></button></div>{children}</section></div>
}

function StatusBadge({ value }) {
  const text = String(value || 'Unknown').replaceAll('_', ' ')
  const normalized = text.toLowerCase()
  const color = normalized.includes('done') || normalized.includes('healthy') || normalized.includes('approved') || normalized.includes('authenticated') ? 'green' : normalized.includes('low') || normalized.includes('draft') || normalized.includes('waiting') || normalized.includes('ready') ? 'amber' : normalized.includes('out') || normalized.includes('reject') || normalized.includes('cancel') ? 'red' : 'slate'
  return <span className={`status-badge badge-${color}`}><span />{text}</span>
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export default App