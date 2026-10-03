import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

type Kind = 'pet' | 'keg' | 'empty_keg'
type MovementType = 'in' | 'out' | 'return' | 'adjustment'
type Product = { id: string; name: string; package_kind: Kind; volume_l: number; active: boolean; reorder_level: number }
type Customer = { id: string; name: string; active: boolean }
type Movement = { id: string; movement_type: MovementType; product_id: string | null; product_name: string | null; quantity: number; customer_id: string | null; customer_name: string | null; note: string | null; created_at: string }
type View = 'stock' | 'customers' | 'history' | 'products'
const label = (p: Product) => p.package_kind === 'pet' ? `PET ${p.volume_l} l` : p.package_kind === 'keg' ? `Sud ${p.volume_l} l` : `Prázdný sud ${p.volume_l} l`
const fmt = (d: string) => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d))

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [loans, setLoans] = useState<Record<string, number>>({})
  const [movements, setMovements] = useState<Movement[]>([])
  const [view, setView] = useState<View>('stock')
  const [modal, setModal] = useState<MovementType | 'product' | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!supabase || !session) return
    setLoading(true)
    const [p, c, b, l, m] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('stock_balances').select('*'),
      supabase.from('keg_loans').select('*'),
      supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    const fail = [p, c, b, l, m].map(x => x.error).find(Boolean)
    if (fail) setError(fail.message)
    else {
      setProducts(p.data ?? []); setCustomers(c.data ?? [])
      setBalances(Object.fromEntries((b.data ?? []).map(x => [x.product_id, x.quantity])))
      setLoans(Object.fromEntries((l.data ?? []).map(x => [`${x.customer_id}-${x.volume_l}`, x.quantity])))
      setMovements(m.data ?? [])
    }
    setLoading(false)
  }, [session])
  useEffect(() => {
    if (!supabase) return
    supabase!.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data } = supabase!.auth.onAuthStateChange((_e, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!supabase || !session) return
    const channel = supabase.channel('pivovar-sklad')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_balances' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'keg_loans' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, load).subscribe()
    return () => { void supabase!.removeChannel(channel) }
  }, [session, load])
  if (!isSupabaseConfigured) return <Notice title="Chybí připojení k databázi">Vytvoř soubor <code>.env.local</code> podle <code>.env.example</code> a vlož URL projektu a publishable key ze Supabase.</Notice>
  if (!session) return <Auth />
  const active = products.filter(p => p.active)
  const productById = new Map(products.map(p => [p.id, p]))
  const customerById = new Map(customers.map(c => [c.id, c]))
  const submitMovement = async (type: MovementType, productId: string, quantity: number, customerId?: string, note?: string) => {
    const { error: rpcError } = await supabase!.rpc('record_stock_movement', { p_movement_type: type, p_product_id: productId, p_quantity: quantity, p_customer_id: customerId || null, p_note: note || null })
    if (rpcError) setError(rpcError.message); else { setModal(null); await load() }
  }
  const addCustomer = async (name: string) => {
    const cleanName = name.trim()
    if (!cleanName) return undefined
    const current = customers.find(c => c.name.toLowerCase() === cleanName.toLowerCase())
    if (current) return current.id
    const { data, error: insertError } = await supabase!.from('customers').insert({ name: cleanName }).select('id').single()
    if (insertError) { setError(insertError.message); return undefined }
    await load(); return data.id
  }
  const deleteProduct = async (product: Product) => {
    const quantity = balances[product.id] ?? 0
    if (quantity > 0) { setError(`Položku „${product.name}“ nejde smazat, dokud je skladem ${quantity} ks.`); return }
    if (!window.confirm(`Opravdu smazat položku „${product.name}“? Historie pohybů zůstane zachovaná.`)) return
    setError('')
    const { error: deleteError } = await supabase!.from('products').delete().eq('id', product.id)
    if (deleteError) setError(deleteError.message); else setProducts(current => current.filter(item => item.id !== product.id))
  }
  const deleteCustomer = async (customer: Customer) => {
    const borrowed = [15, 30, 50].reduce((sum, volume) => sum + (loans[`${customer.id}-${volume}`] ?? 0), 0)
    if (borrowed > 0) { setError(`Odběratele „${customer.name}“ nejde smazat, dokud má ${borrowed} nevrácených sudů.`); return }
    if (!window.confirm(`Opravdu smazat odběratele „${customer.name}“? Historie pohybů zůstane zachovaná.`)) return
    setError('')
    const { error: deleteError } = await supabase!.from('customers').delete().eq('id', customer.id)
    if (deleteError) setError(deleteError.message); else setCustomers(current => current.filter(item => item.id !== customer.id))
  }
  return <main className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark">P</span><div><strong>Pivovar sklad</strong><small>Sdílený živý sklad</small></div></div><button className="text-button" onClick={() => void supabase!.auth.signOut()}>Odhlásit</button></header>
    <section className="hero"><div><p className="eyebrow">Jeden sklad · kusová evidence</p><h1>Aktuální stav skladu</h1><p>Každý pohyb se ihned propíše všem přihlášeným lidem.</p></div><div className="quick-actions"><button className="button secondary" onClick={() => setModal('in')}>+ Naskladnit</button><button className="button primary" onClick={() => setModal('out')}>− Vyskladnit</button><button className="button ghost" onClick={() => setModal('return')}>↩ Vrátit sud</button></div></section>
    <nav className="tabs">{([['stock', 'Sklad'], ['customers', 'Odběratelé'], ['history', 'Historie'], ['products', 'Položky']] as [View, string][]).map(([id, text]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{text}</button>)}</nav>
    {error && <p className="form-error panel">{error}</p>}
    {loading ? <Empty text="Načítám sklad…" /> : <>{view === 'stock' && <Stock products={active} balances={balances} loans={loans}/>}
      {view === 'customers' && <Customers customers={customers} loans={loans} onAdd={addCustomer} onDelete={deleteCustomer}/>}
      {view === 'history' && <History rows={movements} products={productById} customers={customerById}/>}
      {view === 'products' && <Products products={products} balances={balances} onAdd={() => setModal('product')} onDelete={deleteProduct}/>}</>}
    {modal === 'in' && <MovementModal title="Naskladnit pivo" products={active.filter(p => p.package_kind !== 'empty_keg')} onClose={() => setModal(null)} onSave={(v) => submitMovement('in', v.productId, v.quantity, undefined, v.note)}/>}
    {modal === 'out' && <MovementModal title="Vyskladnit pivo" products={active.filter(p => p.package_kind !== 'empty_keg')} customers={customers} balances={balances} customerRequired addCustomer={addCustomer} onClose={() => setModal(null)} onSave={(v) => submitMovement('out', v.productId, v.quantity, v.customerId, v.note)}/>}
    {modal === 'return' && <ReturnModal products={active.filter(p => p.package_kind === 'empty_keg')} customers={customers} loans={loans} onClose={() => setModal(null)} onSave={(v) => submitMovement('return', v.productId, v.quantity, v.customerId)}/>}
    {modal === 'product' && <ProductModal onClose={() => setModal(null)} onSave={async (value) => { const { error } = await supabase!.from('products').insert(value); if (error) setError(error.message); else { setModal(null); await load() } }}/>}
  </main>
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) { return <main className="app-shell"><section className="panel"><h1>{title}</h1><p>{children}</p></section></main> }
function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const login = async (e: FormEvent) => {
    e.preventDefault(); setSubmitting(true); setMessage('')
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    setMessage(error?.message ?? ''); setSubmitting(false)
  }
  const signup = async () => {
    setSubmitting(true); setMessage('')
    const { error } = await supabase!.auth.signUp({ email, password })
    setMessage(error?.message ?? 'Účet je vytvořený. Pokud je potřeba, potvrď e-mail.')
    setSubmitting(false)
  }
  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-form-wrap">
        <div className="auth-form-head">
          <span className="auth-mobile-mark">PS</span>
          <p className="auth-kicker">Interní evidence skladu</p>
          <h2>Přihlášení správce</h2>
          <p>Přihlas se ke skladu pivovaru.</p>
        </div>
        <form className="auth-form" onSubmit={e => void login(e)}>
          <label>E-mail<input required autoComplete="email" type="email" placeholder="jmeno@pivovar.cz" value={email} onChange={e => setEmail(e.target.value)}/></label>
          <label>Heslo<input required autoComplete="current-password" minLength={6} type="password" placeholder="Tvoje heslo" value={password} onChange={e => setPassword(e.target.value)}/></label>
          {message && <p className="form-error auth-message">{message}</p>}
          <button className="button primary auth-submit" disabled={submitting}>{submitting ? 'Pracuji…' : 'Přihlásit se'}</button>
          <button type="button" className="auth-signup" disabled={submitting || !email || password.length < 6} onClick={() => void signup()}>Ještě nemáš účet? <strong>Vytvořit první účet</strong></button>
        </form>
        <p className="auth-footnote">Pivovar sklad · pouze pro oprávněné uživatele</p>
      </div>
    </section>
  </main>
}
function Stock({ products, balances, loans }: { products: Product[]; balances: Record<string, number>; loans: Record<string, number> }) { const low = products.filter(p => (balances[p.id] ?? 0) <= p.reorder_level); return <><section className="summary-grid"><Summary label="Aktivní položky" value={products.length} detail="Sortiment lze kdykoli rozšířit"/><Summary label="Položek dochází" value={low.length} detail={low.length ? low.slice(0, 2).map(p => p.name).join(', ') : 'Vše je nad minimem'} alert={Boolean(low.length)}/><Summary label="Nevrácené sudy" value={Object.values(loans).reduce((a, b) => a + b, 0)} detail="U odběratelů"/></section><section className="panel"><div className="panel-head"><div><h2>Skladové položky</h2><p>Počet kusů, které jsou právě k dispozici.</p></div></div><div className="stock-list">{products.map(p => <article className="stock-row" key={p.id}><div className="product-dot" data-kind={p.package_kind}></div><div className="product-main"><strong>{p.name}</strong><span>{label(p)} · minimum {p.reorder_level} ks</span></div><div className={(balances[p.id] ?? 0) <= p.reorder_level ? 'count low' : 'count'}><strong>{balances[p.id] ?? 0}</strong><span>ks</span></div></article>)}</div></section></> }
function Summary({ label, value, detail, alert }: { label: string; value: number; detail: string; alert?: boolean }) { return <article className={`summary ${alert ? 'alert' : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article> }
function Customers({ customers, loans, onAdd, onDelete }: { customers: Customer[]; loans: Record<string, number>; onAdd: (n: string) => Promise<string | undefined>; onDelete: (customer: Customer) => Promise<void> }) { const [name, setName] = useState(''); const cleanName = name.trim(); return <section className="panel"><div className="panel-head"><div><h2>Odběratelé a vratné sudy</h2><p>Kolik sudů má každý aktuálně u sebe.</p></div><form className="inline-form" onSubmit={async e => { e.preventDefault(); if (!cleanName) return; if (await onAdd(cleanName)) setName('') }}><input required placeholder="Nový odběratel" value={name} onChange={e => setName(e.target.value)}/><button className="button secondary" disabled={!cleanName}>Přidat</button></form></div><div className="customer-list">{customers.filter(c => c.active).map(c => <article className="customer-row" key={c.id}><div className="customer-main"><strong>{c.name}</strong><small>Nevrácené sudy</small></div><div className="customer-actions"><div className="loan-chips">{[15,30,50].map(v => <span key={v}>{loans[`${c.id}-${v}`] ?? 0}× {v} l</span>)}</div><button className="delete-button" title={`Smazat ${c.name}`} aria-label={`Smazat odběratele ${c.name}`} onClick={() => void onDelete(c)}>×</button></div></article>)}</div></section> }
function History({ rows, products, customers }: { rows: Movement[]; products: Map<string, Product>; customers: Map<string, Customer> }) { return <section className="panel"><div className="panel-head"><div><h2>Historie pohybů</h2><p>Každá změna skladu zůstane dohledatelná.</p></div></div>{rows.length ? <div className="history-list">{rows.map(m => <article className="history-row" key={m.id}><span className={`movement-icon ${m.movement_type}`}>{m.movement_type === 'in' ? '+' : m.movement_type === 'out' ? '−' : '↩'}</span><div><strong>{m.movement_type === 'in' ? 'Naskladnění' : m.movement_type === 'out' ? 'Výdej' : 'Vrácený sud'} · {(m.product_id ? products.get(m.product_id)?.name : undefined) ?? m.product_name ?? 'Smazaná položka'}</strong><small>{fmt(m.created_at)}{m.customer_id || m.customer_name ? ` · ${(m.customer_id ? customers.get(m.customer_id)?.name : undefined) ?? m.customer_name ?? 'Smazaný odběratel'}` : ''}{m.note ? ` · ${m.note}` : ''}</small></div><b>{m.movement_type === 'out' ? '−' : '+'}{m.quantity} ks</b></article>)}</div> : <Empty text="Ještě tu nejsou žádné pohyby."/>}</section> }
function Products({ products, balances, onAdd, onDelete }: { products: Product[]; balances: Record<string,number>; onAdd: () => void; onDelete: (product: Product) => Promise<void> }) { return <section className="panel"><div className="panel-head"><div><h2>Správa položek</h2><p>Přidej další pivo nebo nový typ obalu bez zásahu do kódu.</p></div><button className="button primary" onClick={onAdd}>+ Nová položka</button></div><div className="product-table">{products.filter(p => p.active).map(p => <article key={p.id}><div><strong>{p.name}</strong><small>{label(p)}</small></div><span>{balances[p.id] ?? 0} ks</span><button className="delete-button" title={`Smazat ${p.name}`} aria-label={`Smazat položku ${p.name}`} onClick={() => void onDelete(p)}>×</button></article>)}</div></section> }
function MovementModal({ title, products, customers = [], balances, customerRequired, addCustomer, onClose, onSave }: { title:string; products:Product[]; customers?:Customer[]; balances?:Record<string,number>; customerRequired?:boolean; addCustomer?: (n:string)=>Promise<string|undefined>; onClose:()=>void; onSave:(v:{productId:string;quantity:number;customerId?:string;note:string})=>Promise<void> }) { const [productId,setProductId]=useState(products[0]?.id ?? ''); const [quantity,setQuantity]=useState('1'); const [customerId,setCustomerId]=useState(customers[0]?.id ?? ''); const [newCustomer,setNewCustomer]=useState(''); const [note,setNote]=useState(''); return <Modal title={title} onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); const amount=Number(quantity); const id=newCustomer ? await addCustomer?.(newCustomer) : customerId; if (!productId || !Number.isInteger(amount) || amount < 1 || (customerRequired && !id) || (balances && (balances[productId] ?? 0) < amount)) return; await onSave({productId,quantity:amount,customerId:id,note}) }}><label>Položka<select value={productId} onChange={e=>setProductId(e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {label(p)}{balances ? ` · skladem ${balances[p.id] ?? 0} ks` : ''}</option>)}</select></label><label>Množství<input type="number" inputMode="numeric" min="1" value={quantity} onFocus={e=>e.currentTarget.select()} onChange={e=>setQuantity(e.target.value)}/></label>{customerRequired && <><label>Odběratel<select value={customerId} onChange={e=>{setCustomerId(e.target.value);setNewCustomer('')}}><option value="">Vyber odběratele</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Nebo nový odběratel<input value={newCustomer} onChange={e=>{setNewCustomer(e.target.value);setCustomerId('')}}/></label></>}<label>Poznámka <span>nepovinné</span><input value={note} onChange={e=>setNote(e.target.value)}/></label><Actions close={onClose}/></form></Modal> }
function ReturnModal({ products, customers, loans, onClose, onSave }: { products:Product[];customers:Customer[];loans:Record<string,number>;onClose:()=>void;onSave:(v:{productId:string;customerId:string;quantity:number})=>Promise<void> }) { const [productId,setProductId]=useState(products[0]?.id ?? ''); const [customerId,setCustomerId]=useState(customers[0]?.id ?? ''); const [quantity,setQuantity]=useState('1'); const volume=products.find(p=>p.id===productId)?.volume_l; const owed=volume ? loans[`${customerId}-${volume}`] ?? 0 : 0; const amount=Number(quantity); return <Modal title="Vrátit prázdný sud" onClose={onClose}><form className="form-stack" onSubmit={async e=>{e.preventDefault();if(customerId&&Number.isInteger(amount)&&amount>=1&&amount<=owed) await onSave({productId,customerId,quantity:amount})}}><label>Odběratel<select value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Velikost sudu<select value={productId} onChange={e=>setProductId(e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.volume_l} l · nevráceno {loans[`${customerId}-${p.volume_l}`] ?? 0} ks</option>)}</select></label><label>Množství<input type="number" inputMode="numeric" min="1" max={owed} value={quantity} onFocus={e=>e.currentTarget.select()} onChange={e=>setQuantity(e.target.value)}/></label>{quantity!==''&&amount>owed&&<p className="form-error">Odběratel nemá tolik nevrácených sudů.</p>}<Actions close={onClose}/></form></Modal> }
function ProductModal({ onClose,onSave }: {onClose:()=>void;onSave:(v:Omit<Product,'id'>)=>Promise<void>}) { const [name,setName]=useState('');const [kind,setKind]=useState<Kind>('pet');const [volume,setVolume]=useState('0.5');const [minimum,setMinimum]=useState('0');return <Modal title="Nová skladová položka" onClose={onClose}><form className="form-stack" onSubmit={async e=>{e.preventDefault();const volumeValue=Number(volume);const minimumValue=Number(minimum);if(name.trim()&&volumeValue>0&&Number.isInteger(minimumValue)&&minimumValue>=0) await onSave({name:name.trim(),package_kind:kind,volume_l:volumeValue,active:true,reorder_level:minimumValue})}}><label>Název položky<input autoFocus placeholder="Např. APA 11 · PET 0,5 l" value={name} onChange={e=>setName(e.target.value)}/></label><label>Typ obalu<select value={kind} onChange={e=>setKind(e.target.value as Kind)}><option value="pet">PET</option><option value="keg">Plný sud</option><option value="empty_keg">Prázdný vratný sud</option></select></label><label>Objem v litrech<input type="number" inputMode="decimal" min=".1" step=".1" value={volume} onFocus={e=>e.currentTarget.select()} onChange={e=>setVolume(e.target.value)}/></label><label>Upozornit pod počtem<input type="number" inputMode="numeric" min="0" value={minimum} onFocus={e=>e.currentTarget.select()} onChange={e=>setMinimum(e.target.value)}/></label><Actions close={onClose}/></form></Modal> }
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {return <div className="overlay" onMouseDown={onClose}><section className="dialog" onMouseDown={e=>e.stopPropagation()}><div className="dialog-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}>×</button></div>{children}</section></div>}
function Actions({close}:{close:()=>void}) { return <div className="dialog-actions"><button type="button" className="button ghost" onClick={close}>Zrušit</button><button className="button primary">Uložit</button></div> }
function Empty({text}:{text:string}) { return <p className="empty">{text}</p> }
