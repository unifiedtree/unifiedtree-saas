// The documented differences between the Master prototype and the real app,
// applied by scripts/master-build.mjs. Each entry is [prototype text,
// replacement]; a target that isn't found fails the build.
//
// Why they exist (details in docs/Designs/STATIC-UI-TO-BUILD.md §6):
//  - The prototype used codes as ids (EMP-0001, BLR, ENG…); real records are
//    keyed by id and show their code.
//  - Its sample data always had a department, designation, branch, grade and
//    shift; real records may not.
//  - Fields the backend can't store stay on screen, switched off and marked
//    "Coming soon" — never shown as saved.
//  - Copy that promised behaviour the backend doesn't have (payroll paying
//    overtime, year-end carry-forward, statutory "linked components", email on
//    publish…) says what actually happens.
//  - Prototype placeholders (fixed dates, "opens in the full app" toasts) are
//    wired to the real pages.

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']

export const PATCHES = {
  // ── UI kit ────────────────────────────────────────────────────────────────
  e72e9308: [
    // Real dates: TODAY / TODAY_ISO come from masterRuntime (the prototype froze them at 24 Sep 2026).
    ["const TODAY=new Date('2026-09-24T10:00:00');\nconst TODAY_ISO='2026-09-24';\n", ''],
    // Layers portal into the scoped .utm host instead of <body>.
    [',document.body);', ',portalHost());'],
    ["document.querySelector('body>.pop')", "document.querySelector('#utm-portal>.pop')"],
    // A record can have no joining date.
    ['function tenure(s){const m=', "function tenure(s){if(!s)return '—';const m="],
    // Switched-off ("Coming soon") states for controls the design only drew enabled.
    ['function Dropdown({label,value,options,onChange,all,placeholder,field,sm,search,icon,width,align}){', 'function Dropdown({label,value,options,onChange,all,placeholder,field,sm,search,icon,width,align,disabled}){'],
    ["<button type=\"button\" ref={ref} className={'ddb'+(open?' open':'')+(isSet?' set':'')} onClick={()=>setOpen(o=>!o)}>", "<button type=\"button\" ref={ref} disabled={disabled} className={'ddb'+(open?' open':'')+(isSet?' set':'')} onClick={()=>{if(!disabled)setOpen(o=>!o)}}>"],
    ["<div key={i} className={'opt'+(it.danger?' danger':'')} onClick={()=>{setOpen(false);it.on&&it.on()}}>{it.icon&&<Icon name={it.icon} size={16}/>}<span>{it.label}</span></div>", "<div key={i} className={'opt'+(it.danger&&!it.soon?' danger':'')} title={it.soon?(it.tip||'Coming soon'):undefined} style={it.soon?{cursor:'not-allowed',color:'var(--text-disabled)'}:undefined} onClick={()=>{if(it.soon)return;setOpen(false);it.on&&it.on()}}>{it.icon&&<Icon name={it.icon} size={16}/>}<span>{it.label}</span>{it.soon&&<small>{it.soonLabel||'Coming soon'}</small>}</div>"],
    ["function Switch({on,onChange,sm,label}){return <button type=\"button\" role=\"switch\" aria-checked={!!on} aria-label={label} className={'sw'+(on?' on':'')+(sm?' sm':'')} onClick={e=>{e.stopPropagation();onChange(!on)}}></button>}", "function Switch({on,onChange,sm,label,disabled,title}){return <button type=\"button\" role=\"switch\" aria-checked={!!on} aria-label={label} disabled={disabled} title={title} className={'sw'+(on?' on':'')+(sm?' sm':'')} onClick={e=>{e.stopPropagation();if(!disabled)onChange(!on)}}></button>}"],
    ["function Seg({value,options,onChange,full}){return <div className={'seg'+(full?' full':'')}>{options.map(o=>{const x=typeof o==='string'?{v:o,l:o}:o;return <button type=\"button\" key={x.v} className={value===x.v?'on':''} onClick={()=>onChange(x.v)}>", "function Seg({value,options,onChange,full,disabled}){return <div className={'seg'+(full?' full':'')}>{options.map(o=>{const x=typeof o==='string'?{v:o,l:o}:o;return <button type=\"button\" key={x.v} disabled={disabled||x.disabled} title={x.disabled?(x.tip||'Coming soon'):undefined} className={value===x.v?'on':''} onClick={()=>onChange(x.v)}>"],
    ['<Switch on={!!val} onChange={x=>set(f.k,x)} label={f.label}/>', '<Switch on={!!val} disabled={f.disabled} onChange={x=>set(f.k,x)} label={f.label}/>'],
    ['c=<Dropdown field value={val==null?\'\':val} options={opts} onChange={x=>set(f.k,x)} placeholder={ph} search={f.search}/>', 'c=<Dropdown field disabled={f.disabled} value={val==null?\'\':val} options={opts} onChange={x=>set(f.k,x)} placeholder={ph} search={f.search}/>'],
    ['c=<Seg full value={val} options={opts} onChange={x=>set(f.k,x)}/>', 'c=<Seg full disabled={f.disabled} value={val} options={opts} onChange={x=>set(f.k,x)}/>'],
    ["return <button type=\"button\" key={x.v} className={on?'on':''} aria-pressed={on}", "return <button type=\"button\" key={x.v} disabled={f.disabled} className={on?'on':''} aria-pressed={on}"],
    ["<button type=\"button\" key={o.v} className={'rc'+(val===o.v?' on':'')}", "<button type=\"button\" key={o.v} disabled={f.disabled} className={'rc'+(val===o.v?' on':'')}"],
    ["<textarea className=\"input\" rows={f.rows||5}", "<textarea className=\"input\" disabled={f.disabled} rows={f.rows||5}"],
    ["<input className=\"input\" type={f.type||'text'}", "<input className=\"input\" disabled={f.disabled} type={f.type||'text'}"],
    // A switched-off field is never required or validated.
    ['all.forEach(f=>{if(f.when&&!f.when(v))return;', 'all.forEach(f=>{if(f.when&&!f.when(v))return;if(f.disabled)return;'],
    // Missing department / designation / branch show a dash; people are also looked up by id.
    ["return {dept:m(db.depts),desig:m(db.desigs),branch:m(db.branches),co:m(db.companies),grade:m(db.grades),shift:m(db.shifts),byName:m(db.employees,'name')}", "return {dept:orNone(m(db.depts),NONE.dept),desig:orNone(m(db.desigs),NONE.desig),branch:orNone(m(db.branches),NONE.branch),co:m(db.companies),grade:m(db.grades),shift:m(db.shifts),byName:m(db.employees,'name'),emp:m(db.employees)}"],
    // A failed save gets a red toast (the prototype never failed).
    ["<span className={'ti'+(x.kind==='info'?' info':'')}><Icon name={x.kind==='info'?'info':'check'} size={15} stroke={2.6}/></span>", "<span className={'ti'+(x.kind==='info'?' info':x.kind==='error'?' err':'')}><Icon name={x.kind==='info'?'info':x.kind==='error'?'alert-triangle':'check'} size={15} stroke={2.6}/></span>"],
  ],

  // ── Data helpers (the sample data itself is dropped) ─────────────────────
  '444d22cf': [
    // Only the head office is recorded; every other branch is a "Branch".
    ["const BRANCH_KIND_TONE={'Head office':'brand',", "const BRANCH_KIND_TONE={'Head office':'brand','Branch':'cyan',"],
    // The backend's computation types: FORMULA and STATUTORY, and FIXED amounts live on salary structures.
    ["const METHODS={pct_ctc:{l:'% of CTC',d:c=>c.val+'% of CTC'},", "const METHODS={formula:{l:'Formula',d:()=>'Set on each salary structure'},statutory:{l:'Statutory',d:c=>c.note||'From Statutory Settings'},pct_ctc:{l:'% of CTC',d:c=>c.val+'% of CTC'},"],
    ["fixed:{l:'Fixed amount',d:c=>fmtINR(c.val)+' / month'}", "fixed:{l:'Fixed amount',d:c=>c.val!=null?fmtINR(c.val)+' / month':'Set on each salary structure'}"],
  ],

  // ── Section tabs ─────────────────────────────────────────────────────────
  beaaecf6: [
    // Only the sections this user may open.
    ["function TopTabs(){const {route,go,group}=useApp();return <div className=\"stabs\">", "function TopTabs(){const {route,go,group,nav}=useApp();return <div className=\"stabs\" role=\"navigation\" aria-label=\"Master sections\">"],
    ["{NAV.map(g=><button key={g.id} className={'stab'", "{nav.map(g=><button key={g.id} className={'stab'"],
  ],

  // ── Employee Master · Contractor Master · Classification Rules ───────────
  d6399539: [
    // Employee Master: filters can arrive in the URL; codes are shown, ids are keys; real import/export.
    ['const {db,d,update,toast,route,t}=useApp();const M=useMaps();', 'const {db,d,update,toast,route,t,act:ax}=useApp();const M=useMaps();'],
    ["const [dept,setDept]=React.useState('');const [branch,setBranch]=React.useState('');", "const [dept,setDept]=React.useState(route.dept||'');const [branch,setBranch]=React.useState(route.branch||'');"],
    ["const ftNotice=(db.classes.find(c=>c.id==='FT')||{}).notice||60;", "const ftNotice=(db.classes.find(c=>c.code==='FULL_TIME')||db.classes[0]||{}).notice||60;"],
    ["(e.name+' '+e.id+' '+e.email+' '+M.desig[e.desig].name)", "(e.name+' '+e.code+' '+(e.email||'')+' '+M.desig[e.desig].name)"],
    [":k==='dept'?M.dept[e.dept].name:e.id);", ":k==='dept'?M.dept[e.dept].name:e.code);"],
    ["const joinedYr=E.filter(e=>e.joined>='2026-01-01').length;", "const YR=TODAY_ISO.slice(0,4);const joinedYr=E.filter(e=>e.joined>=YR+'-01-01').length;const exitedYr=E.filter(e=>e.status==='Exited'&&(e.exitOn||'')>=YR+'-01-01').length;"],
    ["sub={hc+' people across '+db.companies.length+' companies and '+db.branches.length+' branches. Click anyone to see their full record.'}", "sub={pl(hc,'person','people')+' across '+pl(db.companies.length,'company','companies')+' and '+pl(db.branches.length,'branch','branches')+'. Click anyone to see their full record.'}"],
    ["<button className=\"btn\" onClick={()=>toast('Import from CSV or Excel opens in the full app','info')}><Icon name=\"upload\" size={17}/>Import</button><button className=\"btn\" onClick={()=>toast('Exported '+rows.length+' employees to CSV')}>", "<button className=\"btn\" onClick={()=>ax.importEmployees()}><Icon name=\"upload\" size={17}/>Import</button><button className=\"btn\" onClick={()=>ax.exportEmployees(rows)}>"],
    ["sub={'+'+joinedYr+' joined in 2026'}", "sub={'+'+joinedYr+' joined in '+YR}"],
    ['sub="Joined in the last 6 months"', 'sub="Not yet confirmed"'],
    ["sub={n('Exited')+' exited this year'}", "sub={exitedYr+' exited this year'}"],
    ["options={['Full-time','Part-time','Intern'].map(x=>({v:x,l:x,t:TYPE_TONE[x]}))}", "options={Array.from(new Set(['Full-time','Part-time','Intern'].concat(E.map(e=>e.type)))).map(x=>({v:x,l:x,t:TYPE_TONE[x]}))}"],
    ["options={['Active','Probation','On notice','Exited'].map(x=>", "options={Array.from(new Set(['Active','Probation','On notice','Exited'].concat(E.map(e=>e.status)))).map(x=>"],
    ['<td><span className="code">{e.id}</span></td>', '<td><span className="code">{e.code}</span></td>'],
    ["<td><Pill s={e.status}/>{e.status==='On notice'", "<td><Pill s={e.status}>{e.statusLabel}</Pill>{e.status==='On notice'"],
    // Bulk status: only the people whose status actually changes (confirm, cancel notice or a status edit).
    ["on:()=>{update('employees',L=>L.map(e=>sel.includes(e.id)&&e.status!=='Exited'?Object.assign({},e,{status:s}):e));toast(sel.length+' employees marked '+s.toLowerCase());setSel([])}", "on:()=>{const ch=E.filter(e=>sel.includes(e.id)&&e.status!=='Exited'&&e.status!==s&&!(s==='Probation'&&e.status==='On notice'));if(!ch.length){toast('No one selected can be marked '+s.toLowerCase(),'info');return}const ids=ch.map(e=>e.id);update('employees',L=>L.map(e=>ids.includes(e.id)?Object.assign({},e,{status:s}):e));toast(pl(ch.length,'employee','employees')+' marked '+s.toLowerCase());setSel([])}"],
    ["<button className=\"btn\" onClick={()=>{toast('Exported '+sel.length+' employees to CSV');setSel([])}}>", "<button className=\"btn\" onClick={()=>{ax.exportEmployees(E.filter(e=>sel.includes(e.id)));setSel([])}}>"],
    // Profile drawer: real reporting manager, probation date and shift; a way to the full record.
    ['const {db,go}=useApp();const M=useMaps();', 'const {db,go,act}=useApp();const M=useMaps();'],
    ['sh=M.shift[e.shift]||M.shift.GEN;', 'sh=M.shift[e.shift]||null;'],
    ['const mgrName=dp.head&&dp.head!==e.name?dp.head:(parent&&parent.head!==e.name?parent.head:null);const mgr=mgrName&&M.byName[mgrName];', 'const mgr=e.mgrId?M.emp[e.mgrId]:null;'],
    ['const cls=db.classes.find(c=>c.type===e.type)||db.classes[0];const pm=parseInt(cls.probation)||0;const pe=asDate(e.joined);pe.setMonth(pe.getMonth()+pm);', 'const cls=db.classes.find(c=>c.type===e.type)||db.classes[0]||NONE.cls;'],
    ["const leaves=db.leaves.filter(l=>l.status==='Active'&&l.applies.includes(cls.id)).length;", "const leaves=db.leaves.filter(l=>l.status==='Active'&&(!l.applies||l.applies.includes(cls.id))).length;"],
    ["sub={e.id+' · on record since '+fmtDate(e.joined)}", "sub={e.code+' · on record since '+fmtDate(e.joined)}"],
    ['<span className="sp"></span><button className="btn" onClick={onClose}>Close</button><button className="btn pri" onClick={onEdit}><Icon name="pencil" size={16}/>Edit details</button>', '<span className="sp"></span><button className="btn" onClick={()=>act.openRecord(e.id)}><Icon name="id-card" size={16}/>Full record</button><button className="btn" onClick={onClose}>Close</button><button className="btn pri" onClick={onEdit}><Icon name="pencil" size={16}/>Edit details</button>'],
    ['<Pill s={e.status}/><span className="ttag" style={tone(TYPE_TONE[e.type])}><i></i>{e.type}</span><span className="chip">{gr.id} · {gr.name}</span>', '<Pill s={e.status}>{e.statusLabel}</Pill><span className="ttag" style={tone(TYPE_TONE[e.type])}><i></i>{e.type}</span>{gr&&<span className="chip">{gr.id} · {gr.name}</span>}'],
    ['<span>On probation until <b>{fmtDate(pe.toISOString().slice(0,10))}</b> — {cls.probation} for {cls.name.toLowerCase()} employees.</span>', "<span>{e.probEnd?<>On probation until <b>{fmtDate(e.probEnd)}</b>.</>:'On probation — no confirmation date is set yet.'}</span>"],
    ["{I('Branch',br.name+', '+br.city)}{I('Shift',sh.name+' · '+(sh.kind==='Flexible'?'core '+hm(sh.core[0])+'–'+hm(sh.core[1]):hm(sh.start)+'–'+hm(sh.end)))}", "{I('Branch',br.name+(br.city?', '+br.city:''))}{I('Shift',sh?sh.name+' · '+(sh.kind==='Flexible'&&sh.core?'core '+hm(sh.core[0])+'–'+hm(sh.core[1]):hm(sh.start)+'–'+hm(sh.end)):'—')}"],
    ["{I('Work email',e.email)}{I('Mobile',e.phone)}", "{I('Work email',e.email||'—')}{I('Mobile',e.phone||'—')}"],
    ["{mgr?<Who name={mgr.name} sub={M.desig[mgr.desig].name+' · '+M.dept[mgr.dept].name}/>:<span className=\"warn-link\" onClick={()=>go('departments')}><Icon name=\"alert-triangle\" size={14}/>{dp.name} has no head yet — assign one</span>}", "{mgr?<Who name={mgr.name} sub={M.desig[mgr.desig].name+' · '+M.dept[mgr.dept].name}/>:dp.id&&!dp.headId?<span className=\"warn-link\" onClick={()=>go('departments')}><Icon name=\"alert-triangle\" size={14}/>{dp.name} has no head yet — assign one</span>:<span className=\"muted\">No reporting manager set</span>}"],
    ["Notice · {cls.notice?cls.notice+' days':'per agency'}", "Notice · {cls.notice?cls.notice+' days':'—'}"],
    // Add / edit employee: the company's next code, today's date, real employment types; a company can't be changed.
    ['const {db,update,toast}=useApp();const M=useMaps();const isEdit=!!emp;', 'const {db,update,toast,act}=useApp();const M=useMaps();const isEdit=!!emp;'],
    ["const next='EMP-'+String(Math.max.apply(null,db.employees.map(e=>+e.id.slice(4)))+1).padStart(4,'0');", "const next=act.nextCode||'Assigned when saved';"],
    ["const initial=isEdit?Object.assign({},emp):{co:'utd',branch:'BLR',type:'Full-time',joined:'2026-10-01',shift:'GEN'};", "const initial=isEdit?Object.assign({},emp):{co:act.defaultCo,branch:(db.branches.find(b=>b.co===act.defaultCo&&b.kind==='Head office')||{}).id||'',type:'Full-time',joined:TODAY_ISO,shift:''};"],
    ["{k:'co',label:'Company',type:'select',req:true,options:", "{k:'co',label:'Company',type:'select',req:true,disabled:isEdit,hint:isEdit?'Moving someone to another company isn’t supported yet':undefined,options:"],
    ["{k:'dept',label:'Department',type:'select',req:true,search:true,options:deptOptions(db),clears:['desig']}", "{k:'dept',label:'Department',type:'select',req:true,search:true,options:v=>deptOptions(db).filter(o=>(db.depts.find(x=>x.id===o.v)||{}).co===v.co),clears:['desig']}"],
    ['options:v=>db.desigs.filter(x=>x.dept===v.dept).map(x=>({v:x.id,l:x.name,sub:x.grade}))', 'options:v=>db.desigs.filter(x=>x.co===v.co&&(x.dept===v.dept||!x.dept)).map(x=>({v:x.id,l:x.name,sub:x.grade||undefined}))'],
    ["{k:'type',label:'Employment type',type:'seg',span2:true,options:['Full-time','Part-time','Intern']}", "{k:'type',label:'Employment type',type:'seg',span2:true,options:v=>act.typeOptions(v.type)}"],
    ["{k:'shift',label:'Shift',type:'select',options:", "{k:'shift',label:'Shift',type:'select',disabled:!act.canAssignShift,hint:act.canAssignShift?undefined:'You don’t have access to assign shifts',options:"],
    ['{g&&<span className="chip">{g.id} · {g.name} · {fmtL(g.min)}–{fmtL(g.max)}</span>}', "{g&&<span className=\"chip\">{g.id} · {g.name}{g.min!=null?' · '+fmtL(g.min)+'–'+fmtL(g.max):''}</span>}"],
    ['{isEdit?emp.id:next}', '{isEdit?emp.code:next}'],
    ["notice {cls.notice} days{cls.pf===true?", "notice {cls.notice?cls.notice+' days':'—'}{cls.pf===true?"],
    ["status:isEdit?emp.status:(v.type==='Intern'?'Active':'Probation')});", "status:isEdit?emp.status:'Probation'});"],
    ["toast(isEdit?'Saved changes to '+name:name+' added as '+next);", "toast(isEdit?'Saved changes to '+name:name+(act.nextCode?' added as '+next:' added'));"],
    ["sub={isEdit?emp.id+' · changes apply from the next payroll run'", "sub={isEdit?emp.code+' · changes apply from the next payroll run'"],
    // Contractor Master: worker counts, deployment sites, licences and edits aren't stored yet.
    ['const {db,update,toast}=useApp();const M=useMaps();const [form,setForm]=React.useState(null);const [end,setEnd]', 'const {db,update,toast,act}=useApp();const M=useMaps();const [form,setForm]=React.useState(null);const [end,setEnd]'],
    ["onClick={()=>toast('Exported '+A.length+' agencies to CSV')}", "onClick={()=>act.exportAgencies(A)}"],
    ["value={total} sub={'Deployed across '+new Set(A.filter(a=>a.status==='Active').flatMap(a=>a.sites)).size+' sites'}", "value={A.some(a=>a.workers!=null)?total:'—'} sub={A.some(a=>a.sites)?'Deployed across '+new Set(A.filter(a=>a.status==='Active').flatMap(a=>a.sites||[])).size+' sites':'Worker counts aren’t tracked yet'}"],
    ["t={expiring.length?'red':'green'} label=\"Licences expiring\" value={expiring.length} sub={expiring.length?expiring[0].name+' · '+daysTo(expiring[0].licence)+' days':'All valid for 30+ days'}", "t={expiring.length?'red':A.some(a=>a.licence)?'green':'slate'} label=\"Licences expiring\" value={A.some(a=>a.licence)?expiring.length:'—'} sub={expiring.length?expiring[0].name+' · '+daysTo(expiring[0].licence)+' days':A.some(a=>a.licence)?'All valid for 30+ days':'Licence dates aren’t tracked yet'}"],
    ['<small>{a.service} · Reg. {a.reg}</small>', "<small>{a.service?a.service+' · ':''}Reg. {a.reg||'—'}</small>"],
    ["<Menu items={[{icon:'pencil',label:'Edit agency',on:()=>setForm(a)},on&&{icon:'refresh-cw',label:'Renew licence',on:()=>renew(a)},'-',on?{icon:'ban',label:'End contract',danger:true,on:()=>setEnd(a)}:{icon:'check-circle',label:'Reactivate',on:()=>setStatus(a,'Active')}]}/>", "<Menu items={[{icon:'pencil',label:'Edit agency',soon:true,on:()=>setForm(a)},on&&{icon:'refresh-cw',label:'Renew licence',soon:true,on:()=>renew(a)},'-',on?{icon:'ban',label:'End contract',danger:true,on:()=>setEnd(a)}:{icon:'check-circle',label:'Reactivate',soon:true,on:()=>setStatus(a,'Active')}]}/>"],
    ['<b className="num">{a.workers}</b><span>active workers</span>', "<b className=\"num\">{a.workers==null?'—':a.workers}</b><span>active workers</span>"],
    ['<b>{share}%</b>', "<b>{a.workers==null?'—':share+'%'}</b>"],
    ['<dd>{a.contact}</dd>', "<dd>{a.contact||'—'}</dd>"],
    ['<dd className="num">{a.phone}</dd>', "<dd className=\"num\">{a.phone||'—'}</dd>"],
    ['<dd>{a.email}</dd>', "<dd>{a.email||'—'}</dd>"],
    ["<dd>{a.sites.map(s=>M.branch[s].name).join(', ')}</dd>", "<dd>{a.sites?a.sites.map(s=>M.branch[s].name).join(', '):'—'}</dd>"],
    ["<span>Licence {dd<0?'expired':'valid till'} {fmtDate(a.licence)}</span>", "<span>{a.licence?'Licence '+(dd<0?'expired':'valid till')+' '+fmtDate(a.licence):'Licence dates aren’t tracked yet'}</span>"],
    ['<span className="muted">Since {a.since}</span>', "<span className=\"muted\">{a.since?'Since '+a.since:''}</span>"],
    ["body={end.workers+' contract workers will be released from '+end.sites.map(s=>M.branch[s].name).join(', ')+'. Their attendance stops syncing today.'}", "body=\"The agency is archived and drops off this list. Archived agencies can’t be restored yet.\""],
    ["{k:'service',label:'Service provided',placeholder:'e.g. Security & front desk'}", "{k:'service',label:'Service provided',placeholder:'e.g. Security & front desk',disabled:true,hint:'Coming soon — not saved yet'}"],
    ["validate:x=>x&&x.length?null:'Pick at least one site'}", "validate:x=>x&&x.length?null:'Pick at least one site',disabled:true,hint:'Coming soon — deployment sites aren’t saved yet'}"],
    ["{k:'workers',label:'Active workers',type:'number',min:0,suffix:'people'}", "{k:'workers',label:'Active workers',type:'number',min:0,suffix:'people',disabled:true,hint:'Coming soon'}"],
    ["{k:'licence',label:'Licence valid till',type:'date',req:true,hint:'CLRA licence — we remind you 30 days before expiry'}", "{k:'licence',label:'Licence valid till',type:'date',disabled:true,hint:'Coming soon — licence dates and reminders aren’t saved yet'}"],
    ["const rec=Object.assign({t:'teal',status:'Active',since:'2026'},a||{},v,{id:isEdit?a.id:'A'+Date.now(),workers:+v.workers||0});", "const rec=Object.assign({t:'teal',status:'Active',since:''},a||{},v,{id:isEdit?a.id:'A'+Date.now(),workers:null});"],
    // Classification Rules are the employment types: probation and notice are company-wide, PF/ESI per employee.
    ['<span className="code" style={{marginLeft:8}}>{c.id}</span></span><span className="t2">{c.desc}</span>', '<span className="code" style={{marginLeft:8}}>{c.code}</span></span><span className="t2">{c.desc||c.sub}</span>'],
    ["<td>{c.notice?c.notice+' days':'Per agency'}</td>", "<td>{c.notice?c.notice+' days':'—'}</td>"],
    ['<td><div className="chips"><Ben l="PF" v={c.pf}/><Ben l="ESI" v={c.esi}/><Ben l="Gratuity" v={c.gratuity}/></div></td>', '<td>{c.pf==null?<span className="no">Set per employee</span>:<div className="chips"><Ben l="PF" v={c.pf}/><Ben l="ESI" v={c.esi}/><Ben l="Gratuity" v={c.gratuity}/></div>}</td>'],
    ["<Menu items={[{icon:'pencil',label:'Edit rules',on:()=>setForm(c)},'-',c.status==='Active'?{icon:'ban',label:'Deactivate',danger:true,on:", "<Menu items={[{icon:'pencil',label:'Edit rules',soon:c.system,soonLabel:'Built-in',tip:'Built-in types can’t be changed',on:()=>setForm(c)},'-',c.status==='Active'?{icon:'ban',label:'Deactivate',danger:true,soon:c.system,soonLabel:'Built-in',tip:'Built-in types can’t be changed',on:"],
    ['function ClassForm({c,onClose}){\nconst {update,toast}=useApp();const isEdit=!!c;', 'function ClassForm({c,onClose}){\nconst {update,toast}=useApp();const isEdit=!!c;const sys=!!(c&&c.system);'],
    ["{k:'name',label:'Name',req:true,placeholder:'e.g. Apprentice'},{k:'id',label:'Code',req:true,upper:true,placeholder:'e.g. AP',hint:isEdit?'Codes are locked once people are assigned':'2–4 letters, shown on payslips',validate:x=>String(x).length>=2&&String(x).length<=4?null:'Use 2–4 letters'},{k:'desc',label:'Description',span2:true,placeholder:'Who falls into this classification?'}", "{k:'name',label:'Name',req:true,disabled:sys,hint:sys?'Built-in types can’t be changed':undefined,placeholder:'e.g. Apprentice'},{k:'code',label:'Code',req:true,upper:true,disabled:isEdit,placeholder:'e.g. PART_TIME',hint:isEdit?'Codes are locked — employee records link to them':'Employees link to it by code: FULL_TIME, PART_TIME, INTERN, CONTRACT or CONSULTANT',validate:x=>String(x).length<=30?null:'Use up to 30 characters'},{k:'desc',label:'Description',span2:true,disabled:true,hint:'Coming soon — not saved yet',placeholder:'Who falls into this classification?'}"],
    ["{k:'probation',label:'Probation',type:'select',options:['None','1 month','3 months','6 months']},{k:'notice',label:'Notice period',type:'number',min:0,suffix:'days'},{k:'leave',label:'Leave policy',type:'select',span2:true,options:['Standard','Pro-rated','Casual only','Per agency','None']}", "{k:'probation',label:'Probation',type:'select',disabled:true,hint:'Company-wide — set in HR configuration',options:v=>Array.from(new Set(['None','1 month','3 months','6 months',v.probation].filter(Boolean)))},{k:'notice',label:'Notice period',type:'number',min:0,suffix:'days',disabled:true,hint:'Company-wide — set in HR configuration'},{k:'leave',label:'Leave policy',type:'select',span2:true,disabled:true,hint:'Coming soon — every leave type applies to everyone today',options:v=>Array.from(new Set(['Standard','Pro-rated','Casual only','Per agency','None',v.leave].filter(Boolean)))}"],
    ["{k:'pf',label:'Provident Fund',half:true,type:'toggle',hint:'12% employee + 12% employer'},{k:'esi',label:'ESI',half:true,type:'toggle',hint:'For gross up to ₹21,000'},{k:'gratuity',label:'Gratuity',type:'toggle',hint:'Payable after 5 years of continuous service'},{k:'active',label:'Active',type:'toggle',hint:'Inactive classifications can’t be assigned to new people'}", "{k:'pf',label:'Provident Fund',half:true,type:'toggle',disabled:true,hint:'Set per employee on their salary structure'},{k:'esi',label:'ESI',half:true,type:'toggle',disabled:true,hint:'Set per employee on their salary structure'},{k:'gratuity',label:'Gratuity',type:'toggle',disabled:true,hint:'Coming soon'},{k:'active',label:'Active',type:'toggle',disabled:sys,hint:'Inactive classifications can’t be assigned to new people'}"],
    // Employee Master: a "No department" option (URL departmentId=none) and the dashboard's milestone
    // filters (URL filter=birthday|anniversary|retirement). Milestone matches come from the server
    // (/v1/hrms/employees?milestone=…, the dashboard card's own rules); MasterContainer supplies them as act.milestone.
    ['(!ids||ids.includes(e.dept))', "(!ids||(dept==='__none'?!e.dept:ids.includes(e.dept)))&&(!ax.milestone.value||!!(ax.milestone.ids&&ax.milestone.ids.has(e.id)))"],
    ['<Dropdown label="Department" all="All departments" value={dept} options={deptOptions(db)} onChange={setDept} search icon="layers"/>\n<Dropdown label="Branch"', '<Dropdown label="Department" all="All departments" value={dept} options={deptOptions(db).concat([{v:\'__none\',l:\'No department\',sub:\'People without one\'}])} onChange={setDept} search icon="layers"/>\n<Dropdown label="Branch"'],
    ['onChange={setStatus}/>\n{any&&<button className="btn sm ghost" onClick={clear}>', 'onChange={setStatus}/>\n<Dropdown label="Milestone" all="All people" value={ax.milestone.value} options={ax.milestone.options} onChange={ax.milestone.set} icon="calendar"/>\n{any&&<button className="btn sm ghost" onClick={clear}>'],
    ["const any=!!(status||dept||branch||type||ql);const clear=()=>{setStatus('');setDept('');setBranch('');setType('');setQ('')};", "const any=!!(status||dept||branch||type||ql||ax.milestone.value);const clear=()=>{setStatus('');setDept('');setBranch('');setType('');setQ('');ax.milestone.set('')};"],
    ['usePaged(rows,ps,[status,dept,branch,type,ql,sort.k,sort.d])', 'usePaged(rows,ps,[status,dept,branch,type,ql,sort.k,sort.d,ax.milestone.value,ax.milestone.ids])'],
  ],

  // ── Companies · Branches · Departments · Designations · Grades & Bands ───
  aa085547: [
    [`const IN_STATES=['Karnataka','Maharashtra','Telangana','Tamil Nadu','Haryana','Delhi','Gujarat','Kerala','Uttar Pradesh','West Bengal'];`, `const IN_STATES=${JSON.stringify(STATES).replace(/"/g, "'")};`],
    // Companies: head office comes from the branch marked HQ; TAN and "since" aren't stored.
    ['<small>{c.legal} · {c.industry}</small>', "<small>{[c.legal,c.industry].filter(Boolean).join(' · ')||'Legal name not set'}</small>"],
    ['const depts=new Set(d.live.filter(e=>e.co===c.id).map(e=>e.dept)).size;', 'const depts=new Set(d.live.filter(e=>e.co===c.id&&e.dept).map(e=>e.dept)).size;'],
    ['<span>{c.hq} · since {c.since}</span>', "<span>{c.hq||'No head office branch yet'}{c.since?' · since '+c.since:''}</span>"],
    ["{k:'industry',label:'Industry',type:'select',options:['Software & IT services','Industrial manufacturing','Retail','Healthcare','Financial services','Logistics']},{k:'hq',label:'Registered office',placeholder:'City, State'}", "{k:'industry',label:'Industry',type:'select',options:v=>Array.from(new Set(['Software & IT services','Industrial manufacturing','Retail','Healthcare','Financial services','Logistics',v.industry].filter(Boolean)))},{k:'hq',label:'Registered office',placeholder:'City, State',disabled:true,hint:'Comes from the branch marked Head office'}"],
    ["{k:'TAN',label:'TAN',upper:true,placeholder:'AAAA00000A'}", "{k:'TAN',label:'TAN',upper:true,placeholder:'AAAA00000A',disabled:true,hint:'Coming soon — not saved yet'}"],
    ["const rec=Object.assign({t:'teal',status:'Active',since:'2026'},c||{},{", "const rec=Object.assign({t:'teal',status:'Active',since:''},c||{},{"],
    // Branches: code is shown, ids are keys; only "Head office" is recorded as a type.
    ['const {db,d,update,toast,route}=useApp();const M=useMaps();const [co,setCo]', 'const {db,d,update,toast,route,act}=useApp();const M=useMaps();const [co,setCo]'],
    ["(b.name+' '+b.city+' '+b.state+' '+b.id)", "(b.name+' '+(b.city||'')+' '+(b.state||'')+' '+(b.code||''))"],
    ['<span className="mono" style={{fontSize:11.5}}>{b.id}</span> · {b.city}, {b.state}</span>', "<span className=\"mono\" style={{fontSize:11.5}}>{b.code||'—'}</span> · {[b.city,b.state].filter(Boolean).join(', ')||'—'}</span>"],
    ["setForm({co:co||'utd',kind:'Office',status:'Active'})", "setForm({co:co||act.defaultCo,kind:'Branch',status:'Active'})"],
    ["const icons={'Head office':'building-2','Regional office':'building',", "const icons={'Head office':'building-2','Branch':'building','Regional office':'building',"],
    ["{k:'id',label:'Code',req:true,upper:true,placeholder:'e.g. KOC',validate:x=>!isEdit&&db.branches.some(y=>y.id===x)?'Code already in use':null},{k:'kind',label:'Type',type:'select',options:Object.keys(BRANCH_KIND_TONE)},{k:'co',label:'Company',type:'select',req:true,options:", "{k:'code',label:'Code',req:true,upper:true,placeholder:'e.g. KOC',validate:x=>db.branches.some(y=>y.code===x&&(!isEdit||y.id!==b.id))?'Code already in use':null},{k:'kind',label:'Type',type:'select',options:['Head office','Branch'],hint:'Plant, warehouse and other branch types are coming soon'},{k:'co',label:'Company',type:'select',req:true,disabled:isEdit,options:"],
    ["{k:'state',label:'State',type:'select',req:true,search:true,options:IN_STATES,hint:'Decides Professional Tax and LWF rules'}", "{k:'state',label:'State',type:'select',req:true,search:true,options:v=>Array.from(new Set(IN_STATES.concat(v.state?[v.state]:[]))),hint:'Professional Tax uses one state for now, set in Statutory Settings'}"],
    ['sub="People are assigned to a branch for attendance, holidays and state rules."', 'sub="People are assigned to a branch for attendance and holidays."'],
    // Departments: head by id, code shown; a department can't move under another after it's created.
    ['<span className="meta">{tops.length} departments · {db.depts.length-tops.length} sub-teams</span>', "<span className=\"meta\">{pl(tops.length,'department','departments')} · {pl(db.depts.length-tops.length,'sub-team','sub-teams')}</span>"],
    ['head=x.head&&M.byName[x.head]', 'head=x.headId&&M.emp[x.headId]'],
    ['<span className="t2"><span className="mono" style={{fontSize:11.5}}>{x.id}</span>{x.parent?', "<span className=\"t2\"><span className=\"mono\" style={{fontSize:11.5}}>{x.code||'—'}</span>{x.parent?"],
    ["setPick(x.head&&M.byName[x.head]?M.byName[x.head].id:'')", "setPick(x.headId||'')"],
    ["(x.name+' '+x.id+' '+(x.head||''))", "(x.name+' '+(x.code||'')+' '+(x.head||''))"],
    ['Object.assign({},x,{head:e.name}):x));', 'Object.assign({},x,{head:e.name,headId:e.id}):x));'],
    ["{k:'id',label:'Code',req:true,upper:true,placeholder:'e.g. DSC',validate:v=>!isEdit&&db.depts.some(y=>y.id===v)?'Code already in use':null}", "{k:'code',label:'Code',req:true,upper:true,placeholder:'e.g. DSC',validate:v=>db.depts.some(y=>y.code===v&&(!isEdit||y.id!==x.id))?'Code already in use':null}"],
    ["hint:'Sub-teams roll their headcount up into the parent'}", "disabled:isEdit,hint:isEdit?'Moving a department under another isn’t supported yet':'Sub-teams roll their headcount up into the parent'}"],
    // Designations: no codes; the grade is free text and pay bands aren't stored.
    ['<span className="t2 mono" style={{fontSize:11.5}}>{x.id}</span>', "<span className=\"t2 mono\" style={{fontSize:11.5}}>{x.code||''}</span>"],
    ["<td>{g&&<GradeBadge g={g} sub={fmtL(g.min)+' – '+fmtL(g.max)+' a year'}/>}</td>", "<td>{g?<GradeBadge g={g} sub={g.min!=null?fmtL(g.min)+' – '+fmtL(g.max)+' a year':'Pay band not set'}/>:x.grade?<span className=\"chip\">{x.grade}</span>:<span className=\"no\">—</span>}</td>"],
    ["setForm({dept:dept||'ENG',grade:'L2'})", "setForm({dept:dept||'',grade:''})"],
    ["sub:fmtL(g.min)+'–'+fmtL(g.max),t:g.t}))", "sub:g.min!=null?fmtL(g.min)+'–'+fmtL(g.max):undefined,t:g.t}))"],
    ["<GradeBadge g={g} sub={fmtL(g.min)+' – '+fmtL(g.max)+' annual CTC · midpoint '+fmtL((g.min+g.max)/2)}/>", "<GradeBadge g={g} sub={g.min!=null?fmtL(g.min)+' – '+fmtL(g.max)+' annual CTC · midpoint '+fmtL((g.min+g.max)/2):'Pay band not set yet'}/>"],
    // Grades: ordered by level; pay bands can't be saved yet; grades can be switched off (as in Org Setup).
    ['const G=db.grades.slice().sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));', 'const G=db.grades.slice().sort((a,b)=>((a.level||0)-(b.level||0))||a.id.localeCompare(b.id,undefined,{numeric:true}));'],
    ["<span className=\"s\" style={{left:Math.min(100,g.min/HI*100)+'%',width:Math.max(1,Math.min(100,(g.max-g.min)/HI*100))+'%'}}></span></div></td>", "{g.min!=null&&<span className=\"s\" style={{left:Math.min(100,g.min/HI*100)+'%',width:Math.max(1,Math.min(100,(g.max-g.min)/HI*100))+'%'}}></span>}</div></td>"],
    ["<td><span className=\"t1 num\">{fmtL(g.min)} – {fmtL(g.max)}</span><span className=\"t2\">{ov?'Overlaps '+prev.id+' by '+fmtL(ov):'Midpoint '+fmtL((g.min+g.max)/2)}</span></td>", "<td>{g.min==null?<><span className=\"no\">—</span><span className=\"t2\">Band not set yet</span></>:<><span className=\"t1 num\">{fmtL(g.min)} – {fmtL(g.max)}</span><span className=\"t2\">{ov?'Overlaps '+prev.id+' by '+fmtL(ov):'Midpoint '+fmtL((g.min+g.max)/2)}</span></>}</td>"],
    ["<Menu items={[{icon:'pencil',label:'Edit band',on:()=>setForm(g)}]}/>", "<Menu items={[{icon:'pencil',label:'Edit band',on:()=>setForm(g)},'-',{icon:'ban',label:'Deactivate',danger:true,on:()=>{const n=d.grade[g.id]||0,tl=db.desigs.filter(x=>x.grade===g.id).length;if(n||tl){toast((tl?pl(tl,'title uses','titles use'):pl(n,'person is','people are')+' on')+' '+g.id+' — move them first','info');return}update('grades',L=>L.map(x=>x.id===g.id?Object.assign({},x,{status:'Inactive'}):x));toast(g.id+' · '+g.name+' deactivated')}}]}/>"],
    ["{k:'min',label:'Minimum',type:'number',req:true,prefix:'₹',min:0,step:50000},{k:'max',label:'Maximum',type:'number',req:true,prefix:'₹',min:0,step:50000,validate:(x,v)=>+x>+v.min?null:'Must be more than the minimum'}", "{k:'min',label:'Minimum',type:'number',prefix:'₹',min:0,step:50000,disabled:true,hint:'Coming soon — pay bands aren’t saved yet'},{k:'max',label:'Maximum',type:'number',prefix:'₹',min:0,step:50000,disabled:true}"],
    ["{mn&&mx?fmtL(mn)+' – '+fmtL(mx):'Enter a range'}", "{mn&&mx?fmtL(mn)+' – '+fmtL(mx):'Pay bands are coming soon'}"],
    ["const rec=Object.assign({t:'teal',status:'Active'},g||{},v,{min:+v.min,max:+v.max});", "const rec=Object.assign({t:'teal',status:'Active'},g||{},v,{min:g?g.min:null,max:g?g.max:null});"],
    ['sub="Bands guide offers and revisions — payroll flags salaries outside the band."', 'sub="Grades order your career ladder. Pay bands are coming soon."'],
  ],

  // ── Shift Rules · Leave Rules · Policy Documents ─────────────────────────
  '68265841': [
    // Shifts: duplicating opens a prefilled "Add shift" (there's no inactive state to park a copy in).
    ["const dup=s=>{let id=s.id+'2';while(db.shifts.some(x=>x.id===id))id+='2';update('shifts',L=>L.concat([Object.assign({},s,{id,name:s.name+' (copy)',status:'Inactive'})]));toast('Duplicated '+s.name+' — edit and activate the copy')};", "const dup=s=>setForm({copy:Object.assign({},s,{name:s.name+' (copy)'})});"],
    ['<span className="t2">{s.kind} · {offsLabel(s.offs)}</span>', "<span className=\"t2\">{s.kind}{s.offs?' · '+offsLabel(s.offs):''}</span>"],
    ['<Tip>Multiplier paid for hours worked beyond the daily target. Payroll picks it up from the next cycle.</Tip>', '<Tip>The multiplier recorded for hours beyond the daily target. Overtime is approved in Attendance; payroll doesn’t pay it automatically yet.</Tip>'],
    ['{form&&<ShiftForm s={form.id?form:null} onClose={()=>setForm(null)}/>}', '{form&&<ShiftForm s={form.id?form:null} copy={form.copy} onClose={()=>setForm(null)}/>}'],
    ["function ShiftForm({s,onClose}){\nconst {db,update,toast}=useApp();const isEdit=!!s;\nconst init=s?Object.assign({},s,{startS:hm(s.start),endS:hm(s.end),coreS:s.core?hm(s.core[0]):'11:00',coreE:s.core?hm(s.core[1]):'16:00',grace:s.grace==null?15:s.grace,rate:s.rate||'1.5×',active:s.status==='Active'}):{kind:'Fixed',startS:'09:00',endS:'18:00',coreS:'11:00',coreE:'16:00',grace:15,hours:8,offs:['Sat','Sun'],", "function ShiftForm({s,copy,onClose}){\nconst {db,update,toast}=useApp();const isEdit=!!s;const src=s||copy;\nconst init=src?Object.assign({},src,{_key:s?src._key:undefined,id:s?src.id:'',startS:hm(src.start),endS:hm(src.end),coreS:src.core?hm(src.core[0]):'11:00',coreE:src.core?hm(src.core[1]):'16:00',grace:src.grace==null?15:src.grace,rate:src.rate||'1.5×',active:s?s.status==='Active':true}):{kind:'Fixed',startS:'09:00',endS:'18:00',coreS:'11:00',coreE:'16:00',grace:15,hours:8,offs:[],"],
    ["{k:'id',label:'Code',req:true,upper:true,placeholder:'e.g. GEN',validate:x=>!isEdit&&db.shifts.some(y=>y.id===x)?'Code already in use':null}", "{k:'code',label:'Code',upper:true,placeholder:'e.g. GEN',disabled:true,hint:'Coming soon — shift codes aren’t saved yet'}"],
    ["{k:'kind',label:'Shift type',type:'seg',span2:true,options:[{v:'Fixed',l:'Fixed hours',icon:'clock'},{v:'Flexible',l:'Flexible with core hours',icon:'timer'}]}", "{k:'kind',label:'Shift type',type:'seg',span2:true,options:v=>[{v:'Fixed',l:'Fixed hours',icon:'clock'},{v:'Flexible',l:'Flexible with core hours',icon:'timer'}].concat(v.kind==='Rotational'?[{v:'Rotational',l:'Rotational',icon:'refresh-cw'}]:[])}"],
    ["{k:'coreS',label:'Core hours from',type:'time',when:v=>v.kind==='Flexible'},{k:'coreE',label:'Core hours until',type:'time',when:v=>v.kind==='Flexible'}", "{k:'coreS',label:'Core hours from',type:'time',when:v=>v.kind==='Flexible',disabled:true,hint:'Coming soon — core hours aren’t saved yet'},{k:'coreE',label:'Core hours until',type:'time',when:v=>v.kind==='Flexible',disabled:true}"],
    ["{k:'offs',label:'Weekly off',type:'multi',span2:true,options:WEEK}", "{k:'offs',label:'Weekly off',type:'multi',span2:true,options:WEEK,disabled:true,hint:'Coming soon — weekly offs are set on each employee for now'}"],
    ["{k:'ot',label:'Overtime applicable',type:'toggle',hint:'Hours beyond the daily target are paid at the rate below'}", "{k:'ot',label:'Overtime applicable',type:'toggle',hint:'Records a rate for hours beyond the daily target. Payroll doesn’t pay it automatically yet.'}"],
    ["when:v=>v.ot,options:['1.25×','1.5×','2×']}", "when:v=>v.ot,options:v=>Array.from(new Set(['1.25×','1.5×','2×'].concat(v.rate?[v.rate]:[])))}"],
    ["{k:'active',label:'Active',type:'toggle',hint:'Inactive shifts can’t be assigned to people'}", "{k:'active',label:'Active',type:'toggle',when:()=>isEdit,hint:'Inactive shifts can’t be assigned to people'}"],
    ["'Everyone must be online between '+(v.coreS||'—')+' and '+(v.coreE||'—')+'; the rest of the window is flexible.'", "'People can check in any time in this window. Core hours are coming soon.'"],
    ["(v.ot?'; hours past '+(v.hours||8)+'h are paid at '+v.rate+'.':'.')", "(v.ot?'; overtime past '+(v.hours||8)+'h is recorded at '+v.rate+'.':'.')"],
    ['sub="Changes apply to attendance from tomorrow; past days keep the rules they were marked with."', 'sub="Changes apply to new check-ins; past days keep the marks they already have."'],
    // Leave: codes shown; quota must be > 0; credited upfront; applies to everyone; carry-forward isn't automated.
    ["const LEAVE_CATS=['Casual','Sick','Earned','Statutory','Parental','Comp-off','Special','Unpaid'];", "const LEAVE_CATS=['Casual','Sick','Earned','Maternity','Paternity','Bereavement','Comp-off','Unpaid','Study','Sabbatical'];"],
    ["l.applies.includes(id)&&l.cat!=='Statutory'&&l.cat!=='Parental')", "(!l.applies||l.applies.includes(id))&&l.cat!=='Maternity'&&l.cat!=='Paternity'&&l.cat!=='Comp-off')"],
    ["const C=db.classes.filter(c=>['FT','PT','IN'].includes(c.id));", "const C=db.classes.filter(c=>['Full-time','Part-time','Intern'].includes(c.type));"],
    ['<span className="t1">{l.name}<span className="code" style={{marginLeft:8}}>{l.id}</span></span>', '<span className="t1">{l.name}<span className="code" style={{marginLeft:8}}>{l.code}</span></span>'],
    ["<span className=\"t2\">{l.encash?'Balance encashable at exit':'Not encashable'}</span>", "<span className=\"t2\">{l.encash==null?'':l.encash?'Balance encashable at exit':'Not encashable'}</span>"],
    ['<Tip>Unused days that move into next year, up to the cap. Anything above the cap lapses on 31 December.</Tip>', '<Tip>The most unused days that can move into next year. Moving them at year end isn’t automated yet.</Tip>'],
    ['{db.classes.filter(c=>l.applies.includes(c.id)).map(c=><Pill key={c.id} t={c.t}>{c.id}</Pill>)}', "{l.applies?db.classes.filter(c=>l.applies.includes(c.id)).map(c=><Pill key={c.id} t={c.t}>{c.code}</Pill>):<Pill t=\"slate\">{l.gender==='FEMALE'?'Women':l.gender==='MALE'?'Men':'Everyone'}</Pill>}"],
    ["{k:'id',label:'Code',req:true,upper:true,placeholder:'e.g. MRL',validate:x=>!isEdit&&db.leaves.some(y=>y.id===x)?'Code already in use':null}", "{k:'code',label:'Code',req:true,upper:true,placeholder:'e.g. MRL',validate:x=>db.leaves.some(y=>y.code===x&&(!isEdit||y.id!==l.id))?'Code already in use':null}"],
    ["{k:'quota',label:'Annual quota',type:'number',min:0,suffix:'days / year',hint:'Leave empty for comp-off or unlimited types'}", "{k:'quota',label:'Annual quota',type:'number',min:0,suffix:'days / year',req:true,hint:'Days a year, more than 0',validate:x=>+x>0?null:'Must be more than 0'}"],
    ["{k:'accrual',label:'Credited',type:'seg',options:['Monthly','Quarterly','Upfront']}", "{k:'accrual',label:'Credited',type:'seg',options:['Monthly','Quarterly','Upfront'],disabled:true,hint:'The full quota is credited at the start of the year. Monthly and quarterly accrual are coming soon.'}"],
    ["{k:'carryOn',label:'Carry forward unused days',type:'toggle',hint:'Balances above the cap lapse on 31 December'}", "{k:'carryOn',label:'Carry forward unused days',type:'toggle',hint:'The cap is saved; moving days at year end isn’t automated yet'}"],
    ["{k:'encash',label:'Encashable',type:'toggle',hint:'Unused balance is paid out at exit',when:v=>v.carryOn}", "{k:'encash',label:'Encashable',type:'toggle',hint:'Coming soon',disabled:true,when:v=>v.carryOn}"],
    ["{k:'applies',label:'Applies to',type:'multi',span2:true,options:db.classes.filter(c=>c.id!=='CT').map(c=>({v:c.id,l:c.name})),validate:x=>x&&x.length?null:'Pick at least one classification'}", "{k:'applies',label:'Applies to',type:'multi',span2:true,options:db.classes.map(c=>({v:c.id,l:c.name})),disabled:true,hint:'Coming soon — every leave type applies to everyone today'}"],
    ["{k:'active',label:'Active',type:'toggle',hint:'Inactive types can’t be applied for; balances are kept'}", "{k:'active',label:'Active',type:'toggle',when:()=>isEdit,hint:'Inactive types can’t be applied for; balances are kept'}"],
    ["{cat:'Casual',paidS:'Paid',quota:12,accrual:'Monthly',carryOn:false,carry:30,encash:false,applies:['FT','PT'],active:true}", "{cat:'Casual',paidS:'Paid',quota:12,accrual:'Upfront',carryOn:false,carry:30,encash:false,applies:[],active:true}"],
    ['<span>Joining 1 Oct 2026</span>', "<span>{'Joining '+fmtDate(NEXT_MONTH)}</span>"],
    ["' days carry into 2027'", "' days carry into '+(+TODAY_ISO.slice(0,4)+1)"],
    ['const rec=Object.assign({icon:\'calendar\',t:\'teal\'},l||{},{id:v.id,name:v.name,', 'const rec=Object.assign({icon:\'calendar\',t:\'teal\'},l||{},{id:v.id,code:v.code,name:v.name,'],
    // Policies: real categories; a new version is a new draft; reminders and publish emails don't exist; no delete.
    ['<Dropdown label="Category" all="All categories" value={cat} options={POLICY_CATS} onChange={setCat}/>', '<Dropdown label="Category" all="All categories" value={cat} options={Array.from(new Set(POLICY_CATS.concat(P.map(p=>p.cat).filter(Boolean))))} onChange={setCat}/>'],
    ["Object.assign({},p,{id:'P'+Date.now(),ver:bump(p.ver),status:'Draft',ack:0,eff})", "Object.assign({},p,{_key:undefined,id:'P'+Date.now(),ver:bump(p.ver),status:'Draft',ack:0,eff})"],
    ["<span className=\"t2\">{p.eff>TODAY_ISO?", "<span className=\"t2\">{!p.eff?'':p.eff>TODAY_ISO?"],
    ["{icon:'bell',label:'Remind '+(hc-p.ack)+' people',on:", "{icon:'bell',label:'Remind '+(hc-p.ack)+' people',soon:true,on:"],
    ["{icon:'trash',label:'Discard draft',danger:true,on:()=>{update('policies',L=>L.filter(x=>x.id!==p.id));toast('Draft discarded')}}", "{icon:'trash',label:'Discard draft',danger:true,on:()=>set(p,{status:'Archived'},'Draft discarded — kept under Archived')}"],
    ["{k:'cat',label:'Category',type:'select',options:POLICY_CATS}", "{k:'cat',label:'Category',type:'select',options:v=>Array.from(new Set(POLICY_CATS.concat(v.cat?[v.cat]:[])))}"],
    ["{k:'ackReq',label:'Require acknowledgement',type:'toggle',hint:'Employees see it on login until they confirm they’ve read it'},{k:'notify',label:'Email everyone when published',type:'toggle',hint:'Sent to '+d.headcount+' people'}", "{k:'ackReq',label:'Require acknowledgement',type:'toggle',disabled:true,hint:'Every published policy asks employees to acknowledge it'},{k:'notify',label:'Email everyone when published',type:'toggle',disabled:true,hint:'Coming soon — no email is sent yet'}"],
    ['{cat:\'Workplace\',ver:\'1.0\',eff:TODAY_ISO,ackReq:true,notify:true}', '{cat:\'Workplace\',ver:\'1.0\',eff:TODAY_ISO,ackReq:true,notify:false}'],
    ["const st=isEdit?(mode==='draft'?'Draft':p.status):(mode==='draft'?'Draft':'Active');", "const st=isEdit?(mode==='draft'?'Draft':p.status==='Draft'?'Active':p.status):(mode==='draft'?'Draft':'Active');"],
    ['delete rec.notify;delete rec.content;', 'delete rec.notify;'],
    ["isEdit?rec.title+' updated':rec.title+' published'", "isEdit&&p.status!=='Draft'?rec.title+' updated':rec.title+' published'"],
  ],

  // ── Salary Components · Statutory Settings ───────────────────────────────
  '99fffcea': [
    // The backend's computation types per category.
    ["const METHOD_BY_CAT={Earning:['pct_ctc','pct_basic','fixed','balance'],Deduction:['pct_basic','pct_gross','fixed','variable','slab'],Employer:['pct_basic','pct_gross'],Reimbursement:['capped']};", "const METHOD_BY_CAT={Earning:['fixed','pct_basic','pct_gross','formula'],Deduction:['fixed','pct_basic','pct_gross','statutory'],Employer:['pct_basic','pct_gross','statutory'],Reimbursement:['fixed']};"],
    // The CTC card shows the split new salary structures actually use (Salary Structure page).
    ["function ctcSplit(ctc,comps){const g=c=>comps.find(x=>x.code===c&&x.status==='Active');const B=g('BASIC'),H=g('HRA'),CV=g('CONVEYANCE'),O=g('OTHER_ALLOWANCE'),PF=g('PF_EMPLOYER'),SP=g('SPECIAL');const b=B?ctc*B.val/100:0,h=H?b*H.val/100:0,cv=CV?CV.val*12:0,o=O?O.val*12:0,pf=PF?Math.min(b,180000)*PF.val/100:0;const rest=Math.max(0,ctc-b-h-cv-o-pf);return [{k:'BASIC',l:'Basic',v:b,t:'brand'},{k:'HRA',l:'HRA',v:h,t:'teal'},{k:'SPECIAL',l:SP?'Special allowance':'Unallocated',v:rest,t:SP?'blue':'red'},{k:'CONVEYANCE',l:'Conveyance',v:cv,t:'amber'},{k:'OTHER_ALLOWANCE',l:'Other allowance',v:o,t:'violet'},{k:'PF_EMPLOYER',l:'Employer PF',v:pf,t:'slate'}].filter(x=>x.v>0)}", "function ctcSplit(ctc,comps){const SP=comps.find(x=>x.code==='SPECIAL'&&x.status==='Active');const m=ctc/12,b=Math.round(m*0.5),h=Math.round(b*0.4),cv=m>=20000?1600:0,rest=Math.max(0,m-b-h-cv);return [{k:'BASIC',l:'Basic',v:b*12,t:'brand'},{k:'HRA',l:'HRA',v:h*12,t:'teal'},{k:'SPECIAL',l:SP?'Special allowance':'Unallocated',v:rest*12,t:SP?'blue':'red'},{k:'CONVEYANCE',l:'Conveyance',v:cv*12,t:'amber'}].filter(x=>x.v>0)}"],
    ['<p>Live from the active components below · employer PF capped at the ₹15,000 wage ceiling</p>', '<p>The split new salary structures use · PF, ESI and PT follow Statutory Settings</p>'],
    ["<Switch sm on={c.payslip} label={'Show '+c.name+' on payslip'} onChange={x=>{update('components',L=>L.map(y=>y.code===c.code?Object.assign({},y,{payslip:x}):y));toast(c.name+(x?' now prints':' hidden')+' on payslips')}}/>", "<Switch sm on={!!c.payslip} disabled title=\"Coming soon\" label={'Show '+c.name+' on payslip'} onChange={()=>{}}/>"],
    // Components can't be switched off; unused ones can be deleted (as on the old page).
    ["c.status==='Active'?{icon:'ban',label:'Deactivate',danger:true,on:()=>setSt(c,'Inactive')}:{icon:'check-circle',label:'Activate',on:()=>setSt(c,'Active')}]}/>", "c.status==='Active'?{icon:'ban',label:'Deactivate',danger:true,soon:true,on:()=>setSt(c,'Inactive')}:{icon:'check-circle',label:'Activate',soon:true,on:()=>setSt(c,'Active')},!c.system&&{icon:'trash',label:'Delete component',danger:true,on:()=>setDel(c)}]}/>"],
    ["const {db,update,toast,go}=useApp();const [cat,setCat]=React.useState('');", "const {db,update,toast,go}=useApp();const [del,setDel]=React.useState(null);const [cat,setCat]=React.useState('');"],
    ['{form&&<ComponentForm c={form.code?form:null} init={form} onClose={()=>setForm(null)}/>}', "{form&&<ComponentForm c={form.code?form:null} init={form} onClose={()=>setForm(null)}/>}{del&&<Modal title={'Delete '+del.name+'?'} body=\"It’s removed for good. Components used on a salary structure or payslip can’t be deleted.\" icon=\"trash\" t=\"red\" danger cta=\"Delete\" onClose={()=>setDel(null)} onOk={()=>{const c=del;setDel(null);update('components',L=>L.filter(x=>x.code!==c.code));toast(c.name+' deleted')}}/>}"],
    ["{k:'code',label:'Code',req:true,upper:true,placeholder:'e.g. MEAL',hint:'Used in formulas and payroll exports',", "{k:'code',label:'Code',req:true,upper:true,placeholder:'e.g. MEAL',disabled:isEdit,hint:isEdit?'Codes can’t change once created':'Used in formulas and payroll exports',"],
    ["{k:'valAmt',label:'Amount per month',type:'number',req:true,min:0,prefix:'₹',when:isAmt}", "{k:'valAmt',label:'Amount per month',type:'number',min:0,prefix:'₹',when:isAmt,disabled:true,hint:'Coming soon — amounts are set on each salary structure'}"],
    ["{v:'Partly',l:'Partly exempt'}", "{v:'Partly',l:'Partly exempt',disabled:true}"],
    ["{k:'payslip',label:'Show on payslip',type:'toggle',hint:'Hidden components still count toward CTC'},{k:'active',label:'Active',type:'toggle',hint:'Inactive components are skipped in the next payroll run'}", "{k:'payslip',label:'Show on payslip',type:'toggle',disabled:true,hint:'Coming soon'},{k:'active',label:'Active',type:'toggle',disabled:true,hint:'Coming soon — components can’t be switched off yet'}"],
    ["{cat:'Earning',method:'fixed',taxable:'Yes',payslip:true}", "{cat:'Earning',method:'fixed',taxable:'Yes',payslip:false}"],
    ['const preview=v=>{const ex=1200000,basic=ex*0.4,gross=ex-Math.min(basic,180000)*0.12,', 'const preview=v=>{const ex=1200000,basic=ex*0.5,gross=ex,'],
    ['<span>Basic at 40% · PF capped</span>', '<span>Basic at 50% of gross</span>'],
    [":v.method==='variable'?'Set per employee on their salary record':'Pick how it’s calculated';", ":v.method==='variable'?'Set per employee on their salary record':v.method==='fixed'||v.method==='formula'?'Set on each salary structure':v.method==='statutory'?'Worked out from Statutory Settings':'Pick how it’s calculated';"],
    // Statutory: switching a scheme on/off is the payroll setting; there are no "linked components" to pause.
    ["if(s.comps.length)update('components',L=>L.map(c=>s.comps.includes(c.code)?Object.assign({},c,{status:on?'Active':'Inactive'}):c));toast(s.name+(on?' switched on':' switched off')+(s.comps.length?' · '+s.comps.length+' linked component'+(s.comps.length>1?'s':'')+(on?' resumed':' paused'):''))};", "toast(s.name+(on?' switched on':' switched off'))};"],
    ['sub="Registrations and contribution rules payroll applies by law. Switching a scheme off pauses its components from the next run."', 'sub="Registrations and contribution rules payroll applies by law. Switching a scheme off stops payroll working it out from the next run."'],
    ['<span className="muted" style={{fontWeight:500}}>Deducted in the June & December runs</span>', '<span className="muted" style={{fontWeight:500}}>{s.note}</span>'],
  ],

  // ── Overview ──────────────────────────────────────────────────────────────
  fb5a180e: [
    ['const {db,d,go,counts,toast}=useApp();const hc=d.headcount;', 'const {db,d,go,counts,toast,nav,act}=useApp();const hc=d.headcount;'],
    ["onNotice+' employees serving notice'", "pl(onNotice,'employee','employees')+' serving notice'"],
    ["noHead.length+' departments have no head'", "pl(noHead.length,'department has','departments have')+' no head'"],
    ["unfilled+' designations are unfilled'", "pl(unfilled,'designation is','designations are')+' unfilled'"],
    ["drafts+' policy drafts not yet published'", "pl(drafts,'policy draft','policy drafts')+' not yet published'"],
    ["pending+' policy acknowledgements pending'", "pl(pending,'policy acknowledgement','policy acknowledgements')+' pending'"],
    ["<button className=\"btn\" onClick={()=>toast('Bulk import from CSV or Excel opens in the full app','info')}>", '<button className="btn" onClick={()=>act.importEmployees()}>'],
    ["value={workers} sub={'Through '+db.agencies.filter(a=>a.status==='Active').length+' agencies'}", "value={db.agencies.some(a=>a.workers!=null)?workers:'—'} sub={'Through '+pl(db.agencies.filter(a=>a.status==='Active').length,'agency','agencies')}"],
    ["sub={'Across '+db.companies.length+' companies'}", "sub={'Across '+pl(db.companies.length,'company','companies')}"],
    ['{NAV.map(g=>{const f=flags[g.id].filter(Boolean);', '{nav.map(g=>{const f=flags[g.id].filter(Boolean);'],
  ],
}

// States the design didn't draw: switched-off controls and a failed save.
export const EXTRA_CSS = `
.utm .input:disabled{background:var(--bg-subtle);color:var(--text-tertiary);cursor:not-allowed}
.utm .dd .ddb:disabled{background:var(--bg-subtle);color:var(--text-tertiary);cursor:not-allowed}
.utm .seg button:disabled,.utm .rc:disabled,.utm .field .seg button:disabled{opacity:.5;cursor:not-allowed}
.utm .sw:disabled{opacity:.5;cursor:not-allowed}
.utm .toast .ti.err{background:#ef4444}
/* Real names can be long: the person column truncates (as .who intends) instead of widening the table. */
.utm .t td .who{max-width:320px}
`
