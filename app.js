const STORAGE_KEY='passly-password-requests-v2';
let systems=JSON.parse(localStorage.getItem('passly-systems')||'null')||['Instagram','Microsoft','Adobe User','Meitu','TP-Link / Network','เครื่องพิมพ์ HP','NAS','CapCut','Facebook','Apple ID','Google / Workspace','CCTV / DMSS','Line Business','TikTok','TikTok Ads / Seller','Gmail','Z.com / Hosting','Bitwarden','Website WordPress','Motion'];
const starterRequests=[
{id:crypto.randomUUID(),name:'พิมพ์ชนก วัฒนา',email:'pimchanok@example.com',system:'Google / Workspace',reason:'ใช้งานเอกสารร่วมกันของทีม Marketing',date:'2026-07-17',status:'pending',urgent:true},
{id:crypto.randomUUID(),name:'ณัฐวุฒิ พรชัย',email:'nattawut@example.com',system:'TikTok Ads / Seller',reason:'ตรวจสอบแคมเปญโฆษณาประจำเดือน',date:'2026-07-17',status:'approved',urgent:false},
{id:crypto.randomUUID(),name:'ศิริพร แก้วใจ',email:'siriporn@example.com',system:'Adobe User',reason:'ออกแบบสื่อประชาสัมพันธ์คลินิก',date:'2026-07-16',status:'delivered',urgent:false},
{id:crypto.randomUUID(),name:'ธนกฤต สมบูรณ์',email:'thanakrit@example.com',system:'CCTV / DMSS',reason:'ตรวจสอบเหตุการณ์ย้อนหลัง',date:'2026-07-15',status:'rejected',urgent:false},
{id:crypto.randomUUID(),name:'กิตติภพ นาคินทร์',email:'kittipob@example.com',system:'Microsoft',reason:'เข้าใช้งาน Microsoft Office เครื่องใหม่',date:'2026-07-14',status:'delivered',urgent:false}];
let requests=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')||starterRequests,showAll=false;
const $=s=>document.querySelector(s),esc=v=>{const d=document.createElement('div');d.textContent=v;return d.innerHTML},initials=n=>n.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(),formatDate=v=>new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'2-digit'}).format(new Date(v+'T00:00:00')),save=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify(requests));
const labels={pending:'รออนุมัติ',approved:'อนุมัติแล้ว',delivered:'แจกสำเร็จ',rejected:'ปฏิเสธ'};
function toast(title,message){$('#toastTitle').textContent=title;$('#toastMessage').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function render(){const term=$('#searchInput').value.trim().toLowerCase(),filter=$('#statusFilter').value,filtered=requests.filter(r=>(!term||`${r.name} ${r.email} ${r.system} ${r.reason}`.toLowerCase().includes(term))&&(filter==='all'||r.status===filter)),visible=showAll?filtered:filtered.slice(0,6);
$('#codesBody').innerHTML=visible.map(r=>`<tr><td><div class="user-cell"><span class="user-avatar">${esc(initials(r.name))}</span><span><strong>${esc(r.name)} ${r.urgent?'<em class="urgent-dot">ด่วน</em>':''}</strong><small>${esc(r.email)}</small></span></div></td><td><strong>${esc(r.system)}</strong><small class="masked-pass">Password ••••••••••</small></td><td class="reason-cell">${esc(r.reason)}</td><td>${formatDate(r.date)}</td><td><span class="status ${r.status}">${labels[r.status]}</span></td><td><div class="row-actions">${r.status==='pending'?`<button class="approve-btn" data-action="approve" data-id="${r.id}">อนุมัติ</button><button class="reject-btn" data-action="reject" data-id="${r.id}">ปฏิเสธ</button>`:''}${r.status==='approved'?`<button class="deliver-btn" data-action="deliver" data-id="${r.id}">ส่ง Lark</button>`:''}<button class="edit-btn" data-action="edit" data-id="${r.id}">แก้ไข</button><button class="more-btn" data-action="delete" data-id="${r.id}" title="ลบ">•••</button></div></td></tr>`).join('');
$('#emptyState').hidden=filtered.length>0;$('table').hidden=filtered.length===0;$('#resultCount').textContent=`แสดง ${visible.length} จาก ${filtered.length} รายการ`;$('#showAllBtn').hidden=filtered.length<=6;$('#showAllBtn').textContent=showAll?'ย่อรายการ ↑':'ดูทั้งหมด →';$('#totalStat').textContent=requests.length;$('#activeStat').textContent=requests.filter(x=>x.status==='approved').length;$('#sentStat').textContent=requests.filter(x=>x.status==='delivered').length;$('#expiringStat').textContent=requests.filter(x=>x.status==='pending').length;$('#newStat').textContent=`${requests.filter(x=>x.status==='pending').length} รายการใหม่`;$('#navCount').textContent=requests.length;$('#usageText').textContent='63 / 100';$('#usageBar').style.width='63%'}
function openModal(){$('#modal').hidden=false;document.body.style.overflow='hidden';setTimeout(()=>$('#codeForm [name=name]').focus(),50)}function closeModal(){$('#modal').hidden=true;document.body.style.overflow=''}
function syncSystems(){const options='<option value="">เลือกบัญชีหรือระบบ</option>'+systems.map(x=>`<option>${esc(x)}</option>`).join('');$('#systemSelect').innerHTML=options;$('#editSystemSelect').innerHTML=options;$('#systemGrid').innerHTML=systems.map((x,i)=>`<article class="system-card"><span class="system-icon">${esc(x[0])}</span><div><strong>${esc(x)}</strong><small>พร้อมให้ร้องขอ</small></div><button data-system-edit="${i}">แก้ไข</button><button data-system-delete="${i}">×</button></article>`).join('');$('#vaultCount').textContent=systems.length;localStorage.setItem('passly-systems',JSON.stringify(systems))}
syncSystems();$('#today').textContent=new Intl.DateTimeFormat('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());$('#openModal').onclick=openModal;$('#closeModal').onclick=closeModal;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};$('#searchInput').oninput=render;$('#statusFilter').onchange=render;$('#showAllBtn').onclick=()=>{showAll=!showAll;render()};$('#themeBtn').onclick=()=>document.body.classList.toggle('dark');$('#menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
$('#codeForm').onsubmit=e=>{e.preventDefault();const d=new FormData(e.currentTarget);requests.unshift({id:crypto.randomUUID(),name:d.get('name').trim(),email:d.get('email').trim(),system:d.get('system'),reason:d.get('reason').trim(),date:new Date().toISOString().slice(0,10),status:'pending',urgent:!!d.get('urgent')});save();render();closeModal();e.currentTarget.reset();toast('รับคำขอแล้ว','ส่งให้ผู้ดูแลตรวจสอบและอนุมัติ')};
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){const r=requests.find(x=>x.id===b.dataset.id);if(!r)return;if(b.dataset.action==='approve'){r.status='approved';toast('อนุมัติคำขอแล้ว',`พร้อมส่ง ${r.system} เข้า Lark`)}if(b.dataset.action==='reject'){const reason=prompt('เหตุผลที่ปฏิเสธคำขอ:');if(reason===null)return;r.status='rejected';r.rejectReason=reason}if(b.dataset.action==='deliver'){const f=$('#sendForm');f.elements.id.value=r.id;$('#sendSummary').textContent=`ผู้รับ: ${r.name} · ระบบ: ${r.system}`;$('#sendModal').hidden=false}if(b.dataset.action==='edit'){const f=$('#editForm');f.elements.id.value=r.id;f.name.value=r.name;f.email.value=r.email;f.system.value=r.system;f.reason.value=r.reason;f.status.value=r.status;f.urgent.checked=r.urgent;$('#editModal').hidden=false}if(b.dataset.action==='delete'&&confirm('ลบคำขอนี้ใช่หรือไม่?'))requests=requests.filter(x=>x.id!==r.id);save();render()}
const se=e.target.closest('[data-system-edit]'),sd=e.target.closest('[data-system-delete]');if(se){const v=prompt('แก้ไขชื่อระบบ:',systems[+se.dataset.systemEdit]);if(v){systems[+se.dataset.systemEdit]=v.trim();syncSystems()}}if(sd&&confirm(`ลบ ${systems[+sd.dataset.systemDelete]} ออกจากรายการ?`)){systems.splice(+sd.dataset.systemDelete,1);syncSystems()}});
document.querySelectorAll('.nav-item[data-view]').forEach(a=>a.onclick=()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('.sidebar').classList.remove('open')});
$('#addSystemBtn').onclick=()=>{const v=prompt('ชื่อบัญชีหรือระบบใหม่:');if(v){systems.push(v.trim());syncSystems()}};$('#closeEditModal').onclick=()=>$('#editModal').hidden=true;$('#closeSendModal').onclick=()=>$('#sendModal').hidden=true;
$('#editForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,r=requests.find(x=>x.id===f.elements.id.value);Object.assign(r,{name:f.name.value.trim(),email:f.email.value.trim(),system:f.system.value,reason:f.reason.value.trim(),status:f.status.value,urgent:f.urgent.checked});save();render();$('#editModal').hidden=true;toast('บันทึกแล้ว','อัปเดตข้อมูลคำขอเรียบร้อย')};
const savedLark=JSON.parse(localStorage.getItem('passly-lark')||'{}');$('#larkWebhook').value=savedLark.webhook||'';$('#larkPrefix').value=savedLark.prefix||'[Passly] ข้อมูลการเข้าใช้งาน';$('#larkForm').onsubmit=e=>{e.preventDefault();localStorage.setItem('passly-lark',JSON.stringify({webhook:$('#larkWebhook').value.trim(),prefix:$('#larkPrefix').value.trim()}));toast('บันทึกแล้ว','ตั้งค่า Lark Chat เรียบร้อย')};
async function sendLark(text){const webhook=$('#larkWebhook').value.trim();if(!webhook)throw new Error('กรุณาตั้งค่า Lark webhook ก่อน');const res=await fetch('/api/lark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({webhook,text})});const out=await res.json();if(!res.ok||out.ok===false)throw new Error(out.error||'Lark ส่งข้อความไม่สำเร็จ');return out}
$('#testLarkBtn').onclick=async()=>{try{await sendLark('Passly เชื่อมต่อสำเร็จ ✓');toast('ส่งสำเร็จ','ตรวจสอบข้อความใน Lark Chat')}catch(e){toast('ส่งไม่สำเร็จ',e.message)}};
$('#sendForm [name=showPassword]').onchange=e=>$('#sendForm [name=password]').type=e.target.checked?'text':'password';$('#sendForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,r=requests.find(x=>x.id===f.elements.id.value),prefix=$('#larkPrefix').value.trim();try{await sendLark(`${prefix}\nผู้รับ: ${r.name}\nระบบ: ${r.system}\nUsername: ${f.username.value}\nPassword: ${f.password.value}\nวัตถุประสงค์: ${r.reason}`);r.status='delivered';r.deliveredAt=new Date().toISOString();save();render();f.reset();$('#sendModal').hidden=true;toast('ส่งเข้า Lark แล้ว','บันทึกสถานะแจกสำเร็จ')}catch(err){toast('ส่งไม่สำเร็จ',err.message)}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#editModal').hidden=true;$('#sendModal').hidden=true}});save();render();

let linePollReady=false;
async function pullLineRequests(){
  try{
    const response=await fetch('/api/requests',{cache:'no-store'});
    if(!response.ok)throw new Error('เชื่อมต่อ server ไม่สำเร็จ');
    const payload=await response.json();
    const known=new Set(requests.map(item=>item.id));
    const incoming=(payload.requests||[]).filter(item=>!known.has(item.id));
    if(incoming.length){
      requests=[...incoming,...requests];
      save();
      render();
      if(linePollReady){
        const latest=incoming[0];
        toast('มีคำขอใหม่จาก LINE',`${latest.system} · ${latest.reason}`);
        if(Notification.permission==='granted'){
          new Notification('Passly: คำขอ Password ใหม่',{body:`${latest.system} — ${latest.reason}`,tag:latest.id});
        }
      }
    }
    linePollReady=true;
    $('#lineStatus').textContent=`เชื่อมต่อแล้ว · อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}`;
    $('#lineAlert').classList.remove('offline');
  }catch(error){
    $('#lineStatus').textContent=error.message;
    $('#lineAlert').classList.add('offline');
  }
}
$('#enableNotifications').onclick=async()=>{
  if(!('Notification' in window))return toast('ไม่รองรับ','เบราว์เซอร์นี้ไม่รองรับ Desktop Notification');
  const permission=await Notification.requestPermission();
  toast(permission==='granted'?'เปิดแจ้งเตือนแล้ว':'ยังไม่ได้รับอนุญาต',permission==='granted'?'คำขอ LINE ใหม่จะแจ้งบนหน้าจอ':'เปิดได้ภายหลังจากการตั้งค่าเบราว์เซอร์');
};
pullLineRequests();
setInterval(pullLineRequests,5000);
