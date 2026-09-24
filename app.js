/* Sri Vivekananda Attendance V8. No build step required. */
const API_URL='https://script.google.com/macros/s/AKfycbwtE1xd5Sfi5wpqlIiqFNGpXGJCI720LPRR7tq9K38kCcNUefox-mdVAEQy3RwudOlDgQ/exec';
const SESSION_KEY='SV_JR_SESSION_V8', DRAFT_PREFIX='SV_JR_DRAFT_V8_', PAGE_TTL=45000;
let currentUser=null,authToken='',expiresAt=0,verified=false,db={},attState={},activePage='',viewSeq=0,epoch=0,inflight=0,pageReady=false,refreshPromise=null,dataVersion=0;
const pageCache=new Map(),pendingReads=new Map(),pendingWrites=new Set(),drafts=new Map();
let studentById=new Map(),classById=new Map(),userById=new Map(),examById=new Map(),reportPage=0,lastReport=null,waitingWorker=null,deferredPrompt=null;
const $=id=>document.getElementById(id);
const clean=v=>String(v==null?'':v).trim().toLowerCase();
const same=(a,b)=>clean(a)===clean(b);
const truthy=v=>['yes','true','1','y'].includes(clean(v));
const active=v=>!['no','false','0'].includes(clean(v));
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function today(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;}
function toast(message,duration=4500){const el=document.createElement('div');el.className='toast';el.setAttribute('role','status');el.textContent=message;document.body.appendChild(el);setTimeout(()=>el.remove(),duration);}
function status(message,error=false){$('pageStatus').textContent=message;$('pageStatus').classList.toggle('error',error);}
function sync(){ $('syncBar').style.display=inflight?'block':'none'; }
function badge(text,kind='bblue'){return '<span class="badge '+kind+'">'+esc(text)+'</span>';}
function row(cells){return '<tr>'+cells.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>';}
function button(label,action,attrs='',kind=''){return '<button type="button" class="btn sm '+kind+'" data-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';}
function cls(id){return classById.get(clean(id))||{ClassName:id,ClassID:id,Section:''};}
function stud(id){return studentById.get(clean(id))||{StudentName:id,StudentID:id};}
function user(id){return userById.get(clean(id))||{Name:id};}
function classLabel(c){return (c.ClassName||c.ClassID)+(c.Section?' — '+c.Section:'');}
function normalizeDb(){['users','classes','students','assignments','attendance','holidays','syllabus','exams','marks','editRequests'].forEach(k=>db[k]=db[k]||[]);studentById=new Map(db.students.map(s=>[clean(s.StudentID),s]));classById=new Map(db.classes.map(c=>[clean(c.ClassID),c]));userById=new Map(db.users.map(u=>[clean(u.UserID),u]));examById=new Map(db.exams.map(e=>[clean(e.ExamID),e]));}
function isHoliday(d){return db.holidays.some(h=>h.Date===d);}
function myAttendanceClasses(){if(['admin','principal'].includes(currentUser.Role))return db.classes.filter(c=>active(c.Active));const ids=new Set(db.assignments.filter(a=>same(a.TeacherID,currentUser.UserID)&&truthy(a.CanTakeAttendance)&&active(a.Active)).map(a=>clean(a.ClassID)));return db.classes.filter(c=>ids.has(clean(c.ClassID)));}
function mySyllabusRows(){return db.syllabus;}
function myExams(){return db.exams;}
function opts(el,arr,val='ClassID',label='ClassName',all=''){
  if(!el)return;const previous=el.value;
  el.innerHTML=(all?'<option value="">'+esc(all)+'</option>':'')+arr.map(x=>'<option value="'+esc(x[val])+'">'+esc(typeof label==='function'?label(x):x[label])+'</option>').join('');
  if(Array.from(el.options).some(o=>o.value===previous))el.value=previous;
}
function populateSubjects(){const subs=[...new Set(db.syllabus.map(s=>s.Subject).filter(Boolean))].map(s=>({value:s}));['exSubject','assignSubject'].forEach(id=>opts($(id),subs,'value','value',id==='assignSubject'?'All subjects':''));}
function populateSyllabusClasses(){const ids=new Set(db.syllabus.map(s=>clean(s.ClassID)));opts($('sylClass'),db.classes.filter(c=>ids.has(clean(c.ClassID))),'ClassID',classLabel,'All Classes');}
function populateSyllabusSubjects(){const cid=$('sylClass').value,subs=[...new Set(db.syllabus.filter(r=>!cid||same(r.ClassID,cid)).map(r=>r.Subject))].map(s=>({value:s}));opts($('sylSubject'),subs,'value','value','All Subjects');}
function initFilters(){
  ['attDate','absDate','repDate','exDate'].forEach(id=>{if(!$(id).value)$(id).value=today();});
  if(!$('arFrom').value)$('arFrom').value=today().slice(0,8)+'01';if(!$('arTo').value)$('arTo').value=today();
  if(!$('studentFrom').value)$('studentFrom').value=today().slice(0,8)+'01';if(!$('studentTo').value)$('studentTo').value=today();
  opts($('attClass'),myAttendanceClasses(),'ClassID',classLabel);
  ['absClass','arClass'].forEach(id=>opts($(id),myAttendanceClasses(),'ClassID',classLabel,'All Classes'));
  ['exClass','adSylClass','assignClass'].forEach(id=>opts($(id),db.classes,'ClassID',classLabel));
  ['exTeacher','adTeacher','assignTeacher'].forEach(id=>opts($(id),db.users.filter(u=>clean(u.Role)==='teacher'&&active(u.Active)),'UserID','Name'));
  populateSubjects();populateSyllabusClasses();populateSyllabusSubjects();
  const canAdmin=currentUser.Role==='admin';document.querySelectorAll('[data-admin-only]').forEach(e=>e.classList.toggle('hide',!canAdmin));
}
function buildTabs(){
  let tabs=currentUser.Role==='student'?[['student','My Dashboard']]:[['dashboard','Dashboard']];
  if(currentUser.Role!=='student'){
    if(db.capabilities?.attendance)tabs.push(['attendance','Attendance'],['absentees','Absentees'],['dayreport','Day Report'],['attreport','Attendance Report']);
    if(db.capabilities?.syllabus)tabs.push(['syllabus','Syllabus']);if(db.capabilities?.marks)tabs.push(['marks','Marks']);
    if(['admin','principal'].includes(currentUser.Role))tabs.push(['editrequests','Edit Requests']);if(currentUser.Role==='admin')tabs.push(['admin','Admin']);
  }
  $('tabs').innerHTML=tabs.map(t=>'<button type="button" class="tab'+(activePage===t[0]?' active':'')+'" data-page="'+t[0]+'">'+esc(t[1])+'</button>').join('');
}

// IndexedDB stores a bounded bootstrap snapshot. Large attendance history is never persisted.
let idbPromise;
function cacheDb(){
  if(idbPromise)return idbPromise;
  idbPromise=new Promise(resolve=>{
    if(!window.indexedDB){resolve(null);return;}
    const r=indexedDB.open('SV_Attendance_V8',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);r.onblocked=()=>resolve(null);
  });return idbPromise;
}
function userKey(){return currentUser?currentUser.Role+':'+(currentUser.UserID||currentUser.StudentID):'';}
async function cacheRead(key){try{const c=await cacheDb();if(!c)return null;return await new Promise(resolve=>{const r=c.transaction('snapshots').objectStore('snapshots').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);});}catch(e){return null;}}
async function cacheWrite(key,data){try{const c=await cacheDb();if(c){const tx=c.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({at:Date.now(),data:data},key);}}catch(e){}}
async function cacheRemove(key){try{const c=await cacheDb();if(c)c.transaction('snapshots','readwrite').objectStore('snapshots').delete(key);}catch(e){}}
function saveCache(){
  if(!currentUser)return;const small={};['users','classes','students','assignments','holidays','capabilities'].forEach(k=>small[k]=db[k]);small.meta={version:8,fetchedAt:Date.now()};cacheWrite(userKey(),small);
}
function saveSession(){try{localStorage.setItem(SESSION_KEY,JSON.stringify({user:currentUser,token:authToken,expiresAt:expiresAt}));}catch(e){}}
function draftStorageKey(key){return DRAFT_PREFIX+userKey()+':'+key;}
function getDraft(key){if(drafts.has(key))return drafts.get(key);try{const d=JSON.parse(localStorage.getItem(draftStorageKey(key))||'null');if(d){drafts.set(key,d);return d;}}catch(e){}return null;}
function putDraft(key,value){drafts.set(key,value);try{localStorage.setItem(draftStorageKey(key),JSON.stringify(value));}catch(e){status('Draft kept in this tab. Device storage is unavailable.',true);}}
function clearDraft(key){drafts.delete(key);try{localStorage.removeItem(draftStorageKey(key));}catch(e){}}
function hasDrafts(){if(drafts.size)return true;try{const p=DRAFT_PREFIX+userKey()+':';return Object.keys(localStorage).some(k=>k.startsWith(p));}catch(e){return false;}}
function clearUserDrafts(){try{const p=DRAFT_PREFIX+userKey()+':';Object.keys(localStorage).filter(k=>k.startsWith(p)).forEach(k=>localStorage.removeItem(k));}catch(e){}drafts.clear();}
function expireSession(message){const key=userKey();epoch++;viewSeq++;verified=false;authToken='';try{localStorage.removeItem(SESSION_KEY);}catch(e){}cacheRemove(key);pageCache.clear();pendingReads.clear();$('app').style.display='none';$('login').style.display='flex';$('loginErr').textContent=message||'Please sign in again. Unsaved drafts are retained for this account.';}
async function api(action,payload={}){
  const sentToken=authToken,sentEpoch=epoch,controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);inflight++;sync();
  try{
    const response=await fetch(API_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:action,...payload,...(action==='login'?{}:{token:sentToken})}),signal:controller.signal});
    if(!response.ok)throw new Error('Server returned HTTP '+response.status);
    const result=await response.json();
    if(sentEpoch!==epoch||(action!=='login'&&sentToken!==authToken))throw new Error('Session changed');
    if(!result.success){const error=new Error(result.message||'Request failed');error.code=result.code;if(error.code==='AUTH'&&action!=='login')expireSession(error.message);throw error;}
    if(result.version!==8&&result.data?.meta?.version!==8){const error=new Error('Please deploy the V8 Apps Script backend before using this website.');error.code='VERSION';throw error;}
    if(action!=='login')verified=true;return result;
  }catch(e){if(e.name==='AbortError'){const err=new Error('The request timed out. Your draft is retained; the server may still be finishing.');err.code='NETWORK';throw err;}throw e;}
  finally{clearTimeout(timer);inflight--;sync();}
}
function applyData(data){if(data.meta?.role&&currentUser){currentUser.Role=data.meta.role;saveSession();}Object.keys(data||{}).forEach(k=>{if(k==='report')lastReport=data.report;else db[k]=data[k];});normalizeDb();if(data.classes||data.students||data.syllabus||data.users){initFilters();buildTabs();}if(data.classes||data.students)saveCache();}
function pageRequest(id){
  const p={scope:id};
  if(id==='attendance')Object.assign(p,{classId:$('attClass').value,date:$('attDate').value});
  if(id==='absentees')Object.assign(p,{classId:$('absClass').value,date:$('absDate').value});
  if(id==='dayreport')p.date=$('repDate').value;
  if(id==='attreport')Object.assign(p,{classId:$('arClass').value,from:$('arFrom').value,to:$('arTo').value,session:$('arSession').value});
  if(id==='marks'&&$('markExam').value)p.examId=$('markExam').value;
  if(id==='student')Object.assign(p,{from:$('studentFrom').value,to:$('studentTo').value});return p;
}
async function getPage(p,force=false){
  const key=JSON.stringify(p),cached=pageCache.get(key);if(!force&&cached&&Date.now()-cached.at<PAGE_TTL)return cached.data;
  if(pendingReads.has(key))return pendingReads.get(key);
  const version=dataVersion,promise=api('load',p).then(r=>{if(version!==dataVersion)throw staleRead();pageCache.set(key,{at:Date.now(),data:r.data});if(pageCache.size>12)pageCache.delete(pageCache.keys().next().value);return r.data;}).finally(()=>{if(pendingReads.get(key)===promise)pendingReads.delete(key);});
  pendingReads.set(key,promise);return promise;
}
function staleRead(){const e=new Error('Data changed during loading. Refresh to load the latest records.');e.code='STALE';return e;}
function invalidatePages(...scopes){dataVersion++;pendingReads.clear();for(const k of pageCache.keys()){if(!scopes.length||scopes.includes(JSON.parse(k).scope))pageCache.delete(k);}}
async function show(id,force=false){
  if(!currentUser)return;const tab=document.querySelector('[data-page="'+id+'"]');if(!tab)return;
  activePage=id;const seq=++viewSeq;pageReady=false;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.page===id));
  status('Loading…');$('app').classList.add('page-loading');
  const request=pageRequest(id);
  try{let data;for(let attempt=0;attempt<2;attempt++){const version=dataVersion;try{data=await getPage(request,force||attempt>0);if(version!==dataVersion)throw staleRead();break;}catch(e){if(e.code==='STALE'&&attempt===0&&seq===viewSeq)continue;throw e;}}if(seq!==viewSeq)return;applyData(data);pageReady=true;paintPage(id);status('Last synced '+new Date(data.meta?.fetchedAt||Date.now()).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));}
  catch(e){if(seq===viewSeq)status(e.message+' Use Refresh to try again.',true);}
  finally{if(seq===viewSeq)$('app').classList.remove('page-loading');}
}
function paintPage(id){({dashboard:paintDashboard,attendance:paintAttendance,absentees:paintAbsentees,dayreport:paintDayReport,attreport:paintAttReport,syllabus:paintSyllabus,marks:paintMarks,student:paintStudent,admin:paintAdmin,editrequests:paintEditRequests}[id]||(()=>{}))();}
function startApp(){normalizeDb();$('login').style.display='none';$('app').style.display='block';$('who').textContent=(currentUser.Name||currentUser.StudentName||currentUser.Username)+' ('+currentUser.Role+')';initFilters();buildTabs();}
async function loginUser(){
  if($('loginBtn').disabled)return;$('loginBtn').disabled=true;$('loginSpinner').style.display='block';$('loginErr').textContent='';
  try{const result=await api('login',{username:$('username').value.trim(),password:$('password').value,loginType:$('loginType').value});const r=result.data;epoch++;currentUser=r.user;authToken=r.token;expiresAt=Number(r.expiresAt);verified=true;drafts.clear();db={};pageCache.clear();pendingReads.clear();saveSession();applyData(r.appData);startApp();$('password').value='';
    const id=currentUser.Role==='student'?'student':'dashboard';if(id==='dashboard')pageCache.set(JSON.stringify({scope:'dashboard'}),{at:Date.now(),data:{attendance:db.attendance,holidays:db.holidays,meta:r.appData.meta}});await show(id);
  }catch(e){$('loginErr').textContent=e.message;}finally{$('loginBtn').disabled=false;$('loginSpinner').style.display='none';}
}
async function manualRefresh(){
  if(refreshPromise)return refreshPromise;
  if(pendingWrites.size){toast('Please wait for the current save or SMS request to finish.');return;}
  pageReady=false;invalidatePages();
  refreshPromise=(async()=>{try{const r=await api('load',{scope:'min'});applyData(r.data);const fallback=currentUser.Role==='student'?'student':'dashboard';await show(document.querySelector('[data-page="'+activePage+'"]')?activePage:fallback,true);}catch(e){status(e.message,true);}finally{refreshPromise=null;}})();return refreshPromise;
}
async function silentRefresh(){if(pendingWrites.size)return;return manualRefresh();}
async function logout(){
  if(pendingWrites.size){toast('Please wait for the current save to finish.');return;}
  if(hasDrafts()&&!confirm('Sign out and discard unsaved drafts on this device?'))return;
  try{await api('logout');}catch(e){status('Sign-out could not be confirmed. Please try again.',true);return;}
  const key=userKey();clearUserDrafts();cacheRemove(key);expireSession('');currentUser=null;db={};$('loginErr').textContent='';
}
window.addEventListener('DOMContentLoaded',async()=>{
  // Retire only this app's old cache keys.
  try{localStorage.removeItem('SV_JR_DB');localStorage.removeItem('SV_JR_SESSION');const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(!s||!s.token||Number(s.expiresAt)<=Date.now())return;currentUser=s.user;authToken=s.token;expiresAt=Number(s.expiresAt);const cached=await cacheRead(userKey());db=cached&&Date.now()-cached.at<600000?cached.data:{};startApp();await manualRefresh();}catch(e){expireSession('Please sign in again.');}
});
window.addEventListener('beforeunload',e=>{if(currentUser&&(hasDrafts()||pendingWrites.size)){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',()=>status('Offline. Drafts stay on this device; saving needs a connection.',true));
window.addEventListener('online',()=>status('Connection restored. Use Refresh when ready.'));

function stats(target,items){$(target).innerHTML=items.map(([n,label])=>'<div class="stat"><div class="v">'+esc(n)+'</div><div class="l">'+esc(label)+'</div></div>').join('');}
function paintDashboard(){
  const classes=myAttendanceClasses(),d=today(),records=db.attendance.filter(a=>a.Date===d&&!isHoliday(d)),counts=new Map();
  records.forEach(a=>{const k=clean(a.ClassID)+'|'+clean(a.Session),c=counts.get(k)||{P:0,A:0};if(a.Status in c)c[a.Status]++;counts.set(k,c);});
  const sum=ses=>records.filter(r=>same(r.Session,ses)).reduce((c,r)=>{if(r.Status in c)c[r.Status]++;return c;},{P:0,A:0}),m=sum('Morning'),a=sum('Afternoon');
  stats('dashStats',[[classes.length,'Classes'],[m.P,'Morning Present'],[m.A,'Morning Absent'],[a.P,'Afternoon Present'],[a.A,'Afternoon Absent']]);
  const totals=new Map();db.students.filter(s=>active(s.Active)).forEach(s=>totals.set(clean(s.ClassID),(totals.get(clean(s.ClassID))||0)+1));
  $('todayClass').innerHTML=(isHoliday(d)?'<p>'+badge('Holiday declared','borange')+'</p>':'')+classes.map(c=>{
    const lines=['Morning','Afternoon'].map(ses=>{const v=counts.get(clean(c.ClassID)+'|'+clean(ses))||{P:0,A:0};return esc(ses)+': '+badge(v.P+' Present','bgreen')+' '+badge(v.A+' Absent','bred')+' '+badge(Math.max(0,(totals.get(clean(c.ClassID))||0)-v.P-v.A)+' Not marked');});
    return '<p class="class-summary"><b>'+esc(classLabel(c))+'</b> ('+(totals.get(clean(c.ClassID))||0)+')<br>'+lines.join('<br>')+'</p>';
  }).join('');
}
function attendanceKey(){return 'att:'+JSON.stringify([$ ('attClass').value,$('attDate').value,$('attSession').value]);}
function selectedAttendance(){return db.attendance.filter(a=>a.Date===$('attDate').value&&same(a.Session,$('attSession').value)&&same(a.ClassID,$('attClass').value));}
function attendanceStudents(){return db.students.filter(s=>same(s.ClassID,$('attClass').value)&&active(s.Active));}
function paintAttendance(){
  const c=$('attClass').value,d=$('attDate').value,key=attendanceKey(),draft=getDraft(key),records=selectedAttendance(),saved=records.length>0,busy=pendingWrites.has(key),holiday=isHoliday(d),canWrite=['admin','teacher'].includes(currentUser.Role);
  if(!c||!d){$('attGrid').innerHTML='<p>Select a class and date.</p>';$('attActions').innerHTML='';return;}
  const savedMap=new Map(records.map(a=>[String(a.StudentID),a.Status]));attState=draft?{...draft.statuses}:Object.fromEntries(savedMap);
  $('attInfo').innerHTML=badge(holiday?'Holiday — existing records are retained.':busy?'Saving — waiting for confirmation…':saved?'Attendance saved. Changes require an edit request.':draft?'Unsaved draft restored. Review and save.':'Unmarked students will be saved as Present.',holiday||draft?'borange':'bblue');
  if(saved&&draft&&!busy)$('attInfo').innerHTML+='<p>Your draft is retained. Review any differences before requesting edits.</p>';
  if(holiday){$('attGrid').innerHTML='';$('attActions').innerHTML='';return;}
  $('attGrid').innerHTML=attendanceStudents().map(st=>{
    const id=String(st.StudentID),value=saved?savedMap.get(id)||'P':attState[id]||'P',disabled=busy?' disabled':'';let controls='';
    if(canWrite&&saved){const desired=draft?.statuses?.[id]||value;controls='<select aria-label="New attendance for '+esc(st.StudentName)+'" id="new_'+esc(id)+'"><option value="P"'+(desired==='P'?' selected':'')+'>Present</option><option value="A"'+(desired==='A'?' selected':'')+'>Absent</option></select><input aria-label="Reason for attendance change" id="reason_'+esc(id)+'" placeholder="Reason">'+button('Request edit','edit-request','data-id="'+esc(id)+'"'+disabled);}
    else if(canWrite)controls=button('Present','set-att','data-id="'+esc(id)+'" data-value="P"'+disabled,'green')+' '+button('Absent','set-att','data-id="'+esc(id)+'" data-value="A"'+disabled,'red');
    return '<div class="student-row '+(value==='A'?'absent':'present')+'" id="r_'+esc(id)+'"><div><b>'+esc(st.StudentName)+'</b><br><span class="student-meta">Roll '+esc(st.RollNo)+' | '+esc(st.Village)+' | '+esc(st.ParentPhone)+'</span></div><div class="att-controls">'+controls+'</div></div>';
  }).join('')||'<p>No active students.</p>';
  let controls='';
  if(canWrite&&saved&&!busy)controls=button('Send absence SMS','absent-sms','','green')+' '+button('Retry failed SMS','absent-sms-retry');
  else if(canWrite&&!saved)controls=button('All Present','all-att','data-value="P"'+(busy?' disabled':''))+' '+button('All Absent','all-att','data-value="A"'+(busy?' disabled':''),'red')+' '+button(busy?'Saving…':'Save Attendance','save-att',busy?'disabled':'','primary');
  if(draft&&!busy)controls+=' '+button('Discard draft','discard-att');
  $('attActions').innerHTML='<span id="attTotals"></span> '+controls;paintAttendanceTotals();filterStudents();
}
function paintAttendanceTotals(){if(!$('attTotals'))return;const students=attendanceStudents(),saved=selectedAttendance(),map=saved.length?Object.fromEntries(saved.map(a=>[a.StudentID,a.Status])):attState,absent=students.filter(s=>map[s.StudentID]==='A').length;$('attTotals').textContent=(students.length-absent)+' Present · '+absent+' Absent';}
function filterStudents(){const q=clean($('attSearch').value);attendanceStudents().forEach(s=>{const el=$('r_'+s.StudentID);if(el)el.classList.toggle('hide',q&&!clean(s.StudentName+' '+s.RollNo).includes(q));});}
function setAtt(id,value){if(pendingWrites.has(attendanceKey())||selectedAttendance().length||!pageReady)return;attState[id]=value;putDraft(attendanceKey(),{statuses:{...attState}});const el=$('r_'+id);if(el)el.className='student-row '+(value==='A'?'absent':'present');paintAttendanceTotals();}
function markAll(value){if(pendingWrites.has(attendanceKey())||selectedAttendance().length||!pageReady)return;attendanceStudents().forEach(s=>attState[s.StudentID]=value);putDraft(attendanceKey(),{statuses:{...attState}});paintAttendance();}
function guardWrite(){if(!currentUser||!authToken||!verified||Date.now()>=expiresAt)throw new Error('Sign in or refresh to verify your session before saving.');if(!pageReady)throw new Error('Wait for the selected data to finish loading.');}
function sameAttendance(rows,stored){const map=new Map(stored.map(a=>[clean(a.StudentID),a.Status]));return rows.length===stored.length&&rows.every(a=>map.get(clean(a.StudentID))===a.Status);}
function mergeAttendance(rows){if(!rows.length)return;const r=rows[0];db.attendance=db.attendance.filter(a=>!(a.Date===r.Date&&same(a.Session,r.Session)&&same(a.ClassID,r.ClassID))).concat(rows);}
async function saveAttendance(){
  const key=attendanceKey();if(pendingWrites.has(key))return;
  try{guardWrite();}catch(e){toast(e.message);return;}
  const rows=attendanceStudents().map(st=>({Date:$('attDate').value,Session:$('attSession').value,ClassID:$('attClass').value,StudentID:st.StudentID,Status:attState[st.StudentID]||'P'}));
  if(!rows.length){toast('No active students');return;}
  putDraft(key,{statuses:Object.fromEntries(rows.map(r=>[r.StudentID,r.Status]))});pendingWrites.add(key);paintAttendance();
  try{
    const r=await api('saveAttendance',{records:rows});if(r.data.saved!==rows.length||!sameAttendance(rows,r.data.records||[]))throw new Error('Save confirmation did not match the class. Refresh to check.');
    mergeAttendance(r.data.records);clearDraft(key);invalidatePages('attendance','dashboard','dayreport','absentees','attreport','student');toast('Attendance saved');
  }catch(e){
    // An interrupted response does not prove a failed write. Reconcile once; never blindly retry.
    let confirmed=false;
    if(authToken&&(!e.code||['NETWORK','SERVER','ATTENDANCE_EXISTS'].includes(e.code)))try{const first=rows[0],r=await api('load',{scope:'attendance',classId:first.ClassID,date:first.Date});const saved=r.data.attendance.filter(a=>same(a.Session,first.Session));if(saved.length){invalidatePages('attendance','dashboard','dayreport','absentees','attreport','student');mergeAttendance(saved);}if(sameAttendance(rows,saved)){clearDraft(key);confirmed=true;toast('Attendance saved — confirmed after reconnecting');}}catch(ignore){}
    if(!confirmed)toast(e.message+' Your draft is retained.',7000);
  }finally{pendingWrites.delete(key);if(activePage==='attendance'&&attendanceKey()===key)paintAttendance();}
}
function renderAttendance(){return show('attendance');}
function renderDashboard(){return show('dashboard');}
async function runMutation(key,action,payload,onSuccess){
  if(pendingWrites.has(key))return;try{guardWrite();pendingWrites.add(key);const r=await api(action,payload);await onSuccess(r.data);}catch(e){toast(e.message,6000);}finally{pendingWrites.delete(key);}
}
async function sendEditRequest(sid){const old=selectedAttendance().find(r=>same(r.StudentID,sid));if(!old)return;return runMutation('edit:'+sid,'createEditRequest',{Date:old.Date,Session:old.Session,ClassID:old.ClassID,StudentID:sid,NewStatus:$('new_'+sid).value,Reason:$('reason_'+sid).value},()=>{invalidatePages('editrequests');toast('Edit request sent');});}
function declareHoliday(){const d=$('attDate').value;if(!confirm('Declare '+d+' a holiday? Existing attendance will be retained and excluded from reports.'))return;return runMutation('holiday','declareHoliday',{Date:d},r=>{db.holidays=db.holidays.filter(h=>h.Date!==d).concat([r.holiday]);invalidatePages('attendance','dashboard','dayreport','absentees','attreport','student');if(activePage==='attendance')paintAttendance();toast('Holiday declared; existing attendance retained');});}
function removeHoliday(){const d=$('attDate').value;return runMutation('holiday','removeHoliday',{Date:d},()=>{db.holidays=db.holidays.filter(h=>h.Date!==d);invalidatePages('attendance','dashboard','dayreport','absentees','attreport','student');if(activePage==='attendance')show('attendance',true);toast('Holiday removed');});}
function paintAbsentees(){
  const d=$('absDate').value,c=$('absClass').value,rows=db.attendance.filter(a=>a.Date===d&&a.Status==='A'&&(!c||same(a.ClassID,c)));
  const summary='<tr><td colspan="9">Morning: '+rows.filter(r=>same(r.Session,'Morning')).length+' · Afternoon: '+rows.filter(r=>same(r.Session,'Afternoon')).length+'</td></tr>';
  $('absBody').innerHTML=summary+rows.map(a=>{const st=stud(a.StudentID),count=db.absenceCounts?.[String(a.StudentID)]||{};return row([a.Date,a.Session,classLabel(cls(a.ClassID)),st.RollNo,st.StudentName,st.Village,st.ParentPhone,user(a.MarkedBy).Name,'M: '+(count.Morning||0)+' / A: '+(count.Afternoon||0)]);}).join('');
}
function renderAbsentees(){return show('absentees');}
function paintDayReport(){const date=$('repDate').value,ses=$('repSession').value,counts=new Map(),roster=new Map();db.students.filter(s=>active(s.Active)).forEach(s=>roster.set(clean(s.ClassID),(roster.get(clean(s.ClassID))||0)+1));db.attendance.filter(a=>a.Date===date&&same(a.Session,ses)&&!isHoliday(date)).forEach(a=>{const k=clean(a.ClassID),c=counts.get(k)||{P:0,A:0};if(a.Status in c)c[a.Status]++;counts.set(k,c);});const totals={t:0,p:0,a:0,n:0};$('repBody').innerHTML=myAttendanceClasses().map(c=>{const v=counts.get(clean(c.ClassID))||{P:0,A:0},t=roster.get(clean(c.ClassID))||0,n=isHoliday(date)?0:Math.max(0,t-v.P-v.A);totals.t+=t;totals.p+=v.P;totals.a+=v.A;totals.n+=n;return row([c.ClassName,c.Section,t,v.P,v.A,isHoliday(date)?'Holiday':n]);}).join('');stats('repStats',[[totals.t,'Total'],[totals.p,'Present'],[totals.a,'Absent'],[totals.n,'Not Marked']]);}
function renderDayReport(){return show('dayreport');}
function setRange(kind){const end=today(),d=new Date(end+'T12:00:00Z');let from;if(kind==='month')from=end.slice(0,8)+'01';else{d.setUTCDate(d.getUTCDate()-(kind==='week'?(d.getUTCDay()+6)%7:29));from=d.toISOString().slice(0,10);}$('arFrom').value=from;$('arTo').value=end;return renderAttReport();}
function buildAttReport(){return lastReport||{rows:[],totals:{P:0,A:0,N:0},from:'',to:''};}
function paintAttReport(){
  const {rows,totals,from,to}=buildAttReport(),marked=totals.P+totals.A;reportPage=Math.min(reportPage,Math.max(0,Math.ceil(rows.length/50)-1));
  $('arNote').textContent='Showing '+from+' to '+to+'. Includes archived attendance. Percentage uses marked sessions; missing entries are shown separately.';
  stats('arStats',[[rows.length,'Students'],[totals.P,'Present'],[totals.A,'Absent'],[totals.N,'Not Marked'],[(marked?Math.round(totals.P/marked*1000)/10:0)+'%','Attendance']]);
  const all=window.matchMedia&&window.matchMedia('print').matches;$('arBody').innerHTML=(all?rows:rows.slice(reportPage*50,(reportPage+1)*50)).map(r=>row([r.Roll,r.Name,r.Class,r.Village,r.Phone,r.Held,r.Present,r.Absent,r.NotMarked,r.Pct+'%'])).join('')||'<tr><td colspan="10">No students in this selection.</td></tr>';
  $('arPager').innerHTML=button('Previous','report-page','data-delta="-1"'+(reportPage===0?' disabled':''))+' <span>Page '+(reportPage+1)+' of '+Math.max(1,Math.ceil(rows.length/50))+'</span> '+button('Next','report-page','data-delta="1"'+((reportPage+1)*50>=rows.length?' disabled':''));
}
function renderAttReport(){reportPage=0;lastReport=null;return show('attreport');}
function downloadAttReport(){
  if(!pageReady||!lastReport){toast('Load the selected report first.');return;}
  const {rows,from,to}=lastReport,head=['Roll','Name','Class','Village','Phone','Sessions Held','Present','Absent','Not Marked','Attendance %'];
  const cell=v=>{let t=String(v??'');if(/^[\s]*[=+\-@]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
  const csv=[head,...rows.map(r=>[r.Roll,r.Name,r.Class,r.Village,r.Phone,r.Held,r.Present,r.Absent,r.NotMarked,r.Pct])].map(r=>r.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='attendance_'+from+'_to_'+to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.addEventListener('beforeprint',()=>{if(activePage==='attreport'&&lastReport)$('arBody').innerHTML=lastReport.rows.map(r=>row([r.Roll,r.Name,r.Class,r.Village,r.Phone,r.Held,r.Present,r.Absent,r.NotMarked,r.Pct+'%'])).join('');});
window.addEventListener('afterprint',()=>{if(activePage==='attreport')paintAttReport();});

function paintSyllabus(){
  const cid=$('sylClass').value,sub=$('sylSubject').value,rows=db.syllabus.filter(r=>(!cid||same(r.ClassID,cid))&&(!sub||same(r.Subject,sub)));
  opts($('sylChapter'),rows,'SyllabusID','Chapter');
  $('sylBody').innerHTML=rows.map(r=>row([classLabel(cls(r.ClassID)),r.Subject,r.Chapter,user(r.TeacherID).Name,r.Periods,r.Status,r.UpdatedDate])).join('')||'<tr><td colspan="7">No chapters match this selection.</td></tr>';
  document.querySelectorAll('[data-syllabus-write]').forEach(e=>e.classList.toggle('hide',currentUser.Role==='principal'));
}
function renderSyllabus(){if(activePage==='syllabus'&&pageReady)paintSyllabus();else return show('syllabus');}
function updateSyllabus(value){const id=$('sylChapter').value;if(!id){toast('Select a chapter');return;}return runMutation('syllabus:'+id,'saveSyllabusStatus',{SyllabusID:id,Status:value},r=>{upsertLocal('syllabus',r.record,'SyllabusID');invalidatePages('syllabus','admin');if(activePage==='syllabus')paintSyllabus();toast('Syllabus updated');});}
function paintEditRequests(){const admin=currentUser.Role==='admin';$('editReqBody').innerHTML=db.editRequests.slice().reverse().map(r=>'<tr>'+[r.Date,r.Session,classLabel(cls(r.ClassID)),stud(r.StudentID).StudentName,r.OldStatus,r.NewStatus,r.Reason,r.Status].map(x=>'<td>'+esc(x)+'</td>').join('')+'<td>'+(admin&&r.Status==='Pending'?button('Approve','approve','data-id="'+esc(r.RequestID)+'"','green')+' '+button('Reject','reject','data-id="'+esc(r.RequestID)+'"','red'):'')+'</td></tr>').join('')||'<tr><td colspan="9">No edit requests.</td></tr>';}
function approveReq(id){return runMutation('request:'+id,'approveEditRequest',{RequestID:id},()=>{const r=db.editRequests.find(x=>same(x.RequestID,id));if(r)r.Status='Approved';invalidatePages('editrequests','attendance','dashboard','absentees','dayreport','attreport','student');if(activePage==='editrequests')paintEditRequests();toast('Edit approved');});}
function rejectReq(id){return runMutation('request:'+id,'rejectEditRequest',{RequestID:id},()=>{const r=db.editRequests.find(x=>same(x.RequestID,id));if(r)r.Status='Rejected';invalidatePages('editrequests');if(activePage==='editrequests')paintEditRequests();toast('Edit rejected');});}
function marksKey(eid=$('markExam').value){return 'marks:'+eid;}
function markFingerprint(m){return m?JSON.stringify([String(m.MarksObtained??''),String(m.Status||''),String(m.Timestamp||'')]):null;}
function paintMarks(){
  $('examCreate').classList.toggle('hide',currentUser.Role!=='admin');opts($('markExam'),db.exams,'ExamID',e=>e.ExamName+' — '+classLabel(cls(e.ClassID))+' — '+e.Subject);
  paintMarksEntry();const eid=$('markExam').value,exam=examById.get(clean(eid))||{};
  const rows=db.marks.filter(m=>same(m.ExamID,eid));$('marksReport').innerHTML=rows.map(m=>row([exam.ExamName,classLabel(cls(exam.ClassID)),exam.Subject,stud(m.StudentID).StudentName,m.MarksObtained,m.Status,user(m.EnteredBy).Name])).join('')||'<tr><td colspan="7">No saved marks for this exam.</td></tr>';
}
function paintMarksEntry(){
  const eid=$('markExam').value,exam=examById.get(clean(eid));if(!exam){$('markGrid').innerHTML='<p>No exams assigned.</p>';return;}
  const draft=getDraft(marksKey(eid)),saved=new Map(db.marks.filter(m=>same(m.ExamID,eid)).map(m=>[clean(m.StudentID),m])),busy=pendingWrites.has(marksKey(eid)),canWrite=['admin','teacher'].includes(currentUser.Role),disabled=!canWrite||busy?' disabled':'';
  $('markGrid').innerHTML=(draft?'<p>'+badge(draft.conflict?'Saved marks changed. Your draft is retained.':'Unsaved marks draft restored','borange')+'</p>'+(draft.conflict?'<p>Copy any entries you want to keep, discard this draft, then refresh to review the saved marks before editing again.</p>':''):'')+db.students.filter(s=>same(s.ClassID,exam.ClassID)&&active(s.Active)).map(st=>{
    const old=saved.get(clean(st.StudentID)),d=draft?.values?.[String(st.StudentID)],value=d?d.value:old?.MarksObtained??'',absent=d?d.status==='Absent':old?.Status==='Absent';
    return '<div class="student-row"><div><b>'+esc(st.StudentName)+'</b><br>'+esc(st.RollNo)+'</div><div class="mark-inputs"><input type="number" min="0" max="'+esc(exam.MaxMarks)+'" step="any" aria-label="Marks for '+esc(st.StudentName)+'" id="mk_'+esc(st.StudentID)+'" value="'+esc(value)+'" data-mark="'+esc(st.StudentID)+'"'+disabled+(absent?' disabled':'')+'><label class="check-label"><input type="checkbox" id="ab_'+esc(st.StudentID)+'" data-mark="'+esc(st.StudentID)+'"'+(absent?' checked':'')+disabled+'> Absent</label></div></div>';
  }).join('')+(canWrite?button(busy?'Saving…':'Save Marks','save-marks',busy?'disabled':'','primary')+' '+button('Send marks SMS','marks-sms',(busy||draft)?'disabled':'','green')+' '+button('Retry failed SMS','marks-sms-retry',(busy||draft)?'disabled':''):'')+(draft&&!busy?' '+button('Discard marks draft','discard-marks'):'');
}
function captureMark(sid){
  const eid=$('markExam').value,key=marksKey(eid);if(pendingWrites.has(key)||!pageReady)return;
  const draft=getDraft(key)||{values:{},base:{}};if(!Object.prototype.hasOwnProperty.call(draft.base,sid))draft.base[sid]=markFingerprint(db.marks.find(m=>same(m.ExamID,eid)&&same(m.StudentID,sid)));
  draft.values[sid]={value:$('mk_'+sid).value,status:$('ab_'+sid).checked?'Absent':'Present'};putDraft(key,draft);$('mk_'+sid).disabled=$('ab_'+sid).checked;
  document.querySelectorAll('[data-action="marks-sms"],[data-action="marks-sms-retry"]').forEach(e=>e.disabled=true);
}
async function saveMarks(){
  const eid=$('markExam').value,key=marksKey(eid),exam=examById.get(clean(eid));if(!exam||pendingWrites.has(key))return;
  try{guardWrite();}catch(e){toast(e.message);return;}
  const students=db.students.filter(s=>same(s.ClassID,exam.ClassID)&&active(s.Active)),draft=getDraft(key)||{values:{},base:{}},rows=[];
  for(const st of students){const sid=String(st.StudentID),absent=$('ab_'+sid).checked,value=$('mk_'+sid).value;if(!absent&&(value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>Number(exam.MaxMarks))){toast('Enter marks from 0 to '+exam.MaxMarks+' for '+st.StudentName+', or mark absent.');return;}if(!Object.prototype.hasOwnProperty.call(draft.base,sid))draft.base[sid]=markFingerprint(db.marks.find(m=>same(m.ExamID,eid)&&same(m.StudentID,sid)));draft.values[sid]={value:value,status:absent?'Absent':'Present'};rows.push({ExamID:eid,StudentID:sid,MarksObtained:absent?'':Number(value),Status:absent?'Absent':'Present',Previous:draft.base[sid]});}
  putDraft(key,draft);pendingWrites.add(key);paintMarksEntry();
  try{const r=await api('saveMarks',{records:rows});db.marks=db.marks.filter(m=>!same(m.ExamID,eid)).concat(r.data.records);clearDraft(key);invalidatePages('marks','student');toast('Marks saved');}
  catch(e){if(e.code==='CONFLICT'){draft.conflict=true;putDraft(key,draft);}toast(e.message+' Your marks draft is retained.',7000);}
  finally{pendingWrites.delete(key);if(activePage==='marks'&&$('markExam').value===eid)paintMarks();}
}
function renderMarksEntry(){return show('marks');}
function renderMarks(){return show('marks');}
function upsertLocal(table,value,id){const pos=db[table].findIndex(r=>same(r[id],value[id]));if(pos<0)db[table].push(value);else db[table][pos]=value;normalizeDb();}
function createExam(){return runMutation('exam-create','createExam',{ExamName:$('exName').value,ClassID:$('exClass').value,Subject:$('exSubject').value,MaxMarks:$('exMax').value,ExamDate:$('exDate').value,MarksTeacherID:$('exTeacher').value},r=>{upsertLocal('exams',r,'ExamID');invalidatePages('marks','student');paintMarks();$('exName').value='';toast('Exam created');});}
function paintStudent(){
  const sid=currentUser.StudentID,att=db.attendance.filter(a=>same(a.StudentID,sid)),p=att.filter(a=>a.Status==='P').length,a=att.filter(a=>a.Status==='A').length;
  stats('studentStats',[[p,'Present'],[a,'Absent'],[(p+a?Math.round(p/(p+a)*100):0)+'%','Attendance in selected dates']]);
  $('myAtt').innerHTML=att.slice().sort((a,b)=>b.Date.localeCompare(a.Date)||String(a.Session).localeCompare(String(b.Session))).map(x=>row([x.Date,x.Session,x.Status==='P'?'Present':'Absent'])).join('')||'<tr><td colspan="3">No attendance in this date range.</td></tr>';
  $('myMarks').innerHTML=db.marks.filter(m=>same(m.StudentID,sid)).map(m=>{const e=examById.get(clean(m.ExamID))||{};return row([e.ExamName,e.Subject,m.Status==='Absent'?'Absent':m.MarksObtained+'/'+e.MaxMarks,m.Status]);}).join('')||'<tr><td colspan="4">No marks available.</td></tr>';
}
function renderStudent(){return show('student');}
function paintAdmin(){
  $('usersBody').innerHTML=db.users.map(u=>row([u.UserID,u.Name,u.Username,u.Role,u.Active])).join('');$('assignBody').innerHTML=db.assignments.map(a=>row([a.AssignmentID,user(a.TeacherID).Name,classLabel(cls(a.ClassID)),a.Subject,a.CanTakeAttendance,a.CanUpdateSyllabus])).join('');
}
function addAdminUser(){return runMutation('user-create','saveUser',{Name:$('newUserName').value,Username:$('newUsername').value,Password:$('newUserPass').value,Role:$('newUserRole').value,Active:'YES'},r=>{upsertLocal('users',r,'UserID');invalidatePages('admin');initFilters();paintAdmin();saveCache();$('newUserPass').value='';toast('User saved');});}
function addAssignment(){return runMutation('assignment-save','saveTeacherAssignment',{TeacherID:$('assignTeacher').value,ClassID:$('assignClass').value,Subject:$('assignSubject').value,CanTakeAttendance:$('assignAttendance').value,CanUpdateSyllabus:$('assignSyllabus').value,Active:'YES'},r=>{upsertLocal('assignments',r,'AssignmentID');invalidatePages('admin');initFilters();paintAdmin();saveCache();toast('Assignment saved');});}
function addSyllabus(){return runMutation('syllabus-create','upsertSyllabus',{ClassID:$('adSylClass').value,Subject:$('adSubject').value,Chapter:$('adChapter').value,TeacherID:$('adTeacher').value,Periods:$('adPeriods').value},r=>{upsertLocal('syllabus',r,'SyllabusID');invalidatePages('admin','syllabus');initFilters();paintAdmin();toast('Syllabus plan added');});}
async function sendSMS(kind,retryFailed=false){
  const id=kind==='attendance'?attendanceKey():marksKey(),key='sms:'+id;if(pendingWrites.has(key))return;
  try{guardWrite();}catch(e){toast(e.message);return;}
  if(pendingWrites.has(id)||(kind==='marks'&&getDraft(id))||(kind==='attendance'&&!selectedAttendance().length)){toast('Save and confirm the records before sending SMS.');return;}
  if(!confirm(retryFailed?'Retry only messages that the provider explicitly rejected?':'Send '+(kind==='attendance'?'absence':'marks')+' SMS to parents for the selected '+(kind==='attendance'?'class and session':'exam')+'?'))return;
  const payload=kind==='attendance'?{Date:$('attDate').value,Session:$('attSession').value,ClassID:$('attClass').value}:{ExamID:$('markExam').value};payload.retryFailed=retryFailed;
  pendingWrites.add(key);const totals={sent:0,failed:0,unknown:0};
  try{
    let remaining;do{const r=await api(kind==='attendance'?'sendAbsentSMS':'sendMarksSMS',payload);['sent','failed','unknown'].forEach(k=>totals[k]+=r.data[k]||0);remaining=r.data.remaining||0;status('SMS submitted: '+totals.sent+' · Remaining: '+remaining);if(retryFailed)remaining=0;}while(remaining>0);
    toast('SMS submitted: '+totals.sent+' · Failed: '+totals.failed+' · Unconfirmed: '+totals.unknown,8000);
    if(totals.unknown)status('Some SMS submissions are unconfirmed. Ask the admin to check the provider report before retrying them.',true);
  }catch(e){toast(e.message+' Check SMSLog before retrying an interrupted batch.',8000);}finally{pendingWrites.delete(key);}
}
function sendAbsentSMS(){return sendSMS('attendance');}
function sendMarksSMS(){return sendSMS('marks');}
document.addEventListener('click',event=>{
  const el=event.target.closest('button');if(!el||el.disabled)return;if(el.dataset.page){show(el.dataset.page);return;}
  const id=el.dataset.id,value=el.dataset.value,actions={
    'set-att':()=>setAtt(id,value),'all-att':()=>markAll(value),'save-att':saveAttendance,'edit-request':()=>sendEditRequest(id),
    'absent-sms':sendAbsentSMS,'absent-sms-retry':()=>sendSMS('attendance',true),'save-marks':saveMarks,'marks-sms':sendMarksSMS,'marks-sms-retry':()=>sendSMS('marks',true),
    'approve':()=>approveReq(id),'reject':()=>rejectReq(id),'report-page':()=>{reportPage+=Number(el.dataset.delta);paintAttReport();},
    'discard-att':()=>{if(confirm('Discard this unsaved attendance draft?')){clearDraft(attendanceKey());paintAttendance();}},
    'discard-marks':()=>{if(confirm('Discard this unsaved marks draft?')){clearDraft(marksKey());paintMarksEntry();}},
    'update-app':applyAppUpdate
  };if(actions[el.dataset.action])actions[el.dataset.action]();
});
document.addEventListener('input',event=>{if(event.target.id==='attSearch')filterStudents();if(event.target.dataset.mark)captureMark(event.target.dataset.mark);});
document.addEventListener('change',event=>{if(event.target.dataset.mark)captureMark(event.target.dataset.mark);});

// Updates wait for an explicit click and never reload an unfinished form.
function offerUpdate(worker){waitingWorker=worker;$('updateNotice').classList.remove('hide');}
function applyAppUpdate(){if(hasDrafts()||pendingWrites.size){toast('Save or discard unfinished work before updating the app.');return;}if(waitingWorker){waitingWorker.postMessage('SKIP_WAITING');}else location.reload();}
if('serviceWorker' in navigator)window.addEventListener('load',()=>{
  let applying=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applying&&!hasDrafts()&&!pendingWrites.size)location.reload();});
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    if(reg.waiting)offerUpdate(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate(worker);});});
    const original=applyAppUpdate;applyAppUpdate=function(){if(hasDrafts()||pendingWrites.size){toast('Save or discard unfinished work before updating the app.');return;}applying=true;original();};
  }).catch(()=>{});
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;$('installBtn').style.display='block';});
async function installApp(){if(!deferredPrompt){alert('On iPhone or iPad, use Share → Add to Home Screen. On Android, use the browser menu → Install app.');return;}await deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').style.display='none';}
window.addEventListener('appinstalled',()=>{deferredPrompt=null;$('installBtn').style.display='none';toast('App installed');});
