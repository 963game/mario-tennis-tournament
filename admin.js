import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,inMemoryPersistence,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,getIdTokenResult} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import * as fs from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {divisions,defaultTeams,normalizedName,planRooms,createWorkflows,prepareParticipants,publicMatches} from './tournament.js';
import {mountCsvImport} from './csv-import-ui.js';
import {slotFingerprint} from './csv-import.js';
import {mountAssessment} from './assessment-ui.js';
import {mountTeamDraft} from './team-draft-ui.js';
const app=initializeApp(firebaseConfig,'operator'),auth=getAuth(app),db=fs.getFirestore(app);
const provisionAuth=getAuth(initializeApp(firebaseConfig,'provision-participants'));
await setPersistence(provisionAuth,inMemoryPersistence);
const flows=createWorkflows(fs,db),$=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const say=text=>$('message').textContent=text;
let players=[],requests=[],accepting=false,stops=[],busy=false,accessVersion=0;
const drafts=new Map();
const openRoster=new Set();
let rosterPage=0;
function reportError(e){say(!e?.code && e?.message?e.message:'操作できませんでした。通信と運営権限をご確認ください。アカウント準備中なら同じボタンで再開できます。');}
async function action(button,fn){if(busy)return;busy=true;button.disabled=true;try{await fn();}catch(e){reportError(e);}finally{busy=false;button.disabled=false;}}
const csvImporter=mountCsvImport({api:fs,db,getPlayers:()=>players,getDraftCount:()=>drafts.size,runAction:action,say});
const assessments=mountAssessment({api:fs,db,getPlayers:()=>players,runAction:action,say});
const teamDraft=mountTeamDraft({api:fs,db,getPlayers:()=>players,getDraftCount:()=>drafts.size,runAction:action,say});
function clear(){stops.forEach(stop=>stop());stops=[];players=[];requests=[];drafts.clear();openRoster.clear();rosterPage=0;csvImporter.clear();assessments.clear();teamDraft.clear();$('rosterDraftNotice').textContent='';$('roster').replaceChildren();$('requests').replaceChildren();$('operatorPanel').hidden=true;}
await setPersistence(auth,browserLocalPersistence);
onAuthStateChanged(auth,async user=>{
 const version=++accessVersion;clear();$('operatorLogin').hidden=false;
 if(!user)return;
 try{
  const [role,token]=await Promise.all([fs.getDoc(fs.doc(db,'operators',user.uid)),getIdTokenResult(user)]);
  if(version!==accessVersion)return;
  if(!role.data()?.enabled && token.claims.admin!==true){say('運営権限が未設定です。初回設定手順を確認してください。');return;}
  $('operatorLogin').hidden=true;$('operatorPanel').hidden=false;say('運営として入室中です。');
  stops.push(fs.onSnapshot(fs.collection(db,'participants'),snapshot=>{
    players=snapshot.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>a.id.localeCompare(b.id));renderRoster();renderRequests();assessments.render();teamDraft.render();
  },reportError));
  stops.push(fs.onSnapshot(fs.collection(db,'checkins'),snapshot=>{requests=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderRequests();},reportError));
  stops.push(fs.onSnapshot(fs.doc(db,'settings','checkin'),snapshot=>{accepting=snapshot.data()?.accepting===true;$('acceptingState').textContent=accepting?'受付中':'受付停止中';},reportError));
  stops.push(fs.onSnapshot(fs.doc(db,'public','teamNames'),snapshot=>{
    const names={...defaultTeams,...snapshot.data()?.names};
    $('teamNames').innerHTML=Object.keys(defaultTeams).map(id=>`<label>${id}<input data-team="${id}" value="${escape(names[id])}" maxlength="40"></label>`).join('');
  },reportError));
 }catch(e){if(version===accessVersion)reportError(e);}
});
$('operatorSignIn').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('operatorEmail').value.trim(),$('operatorPassword').value);$('operatorPassword').value='';}catch{say('メールとパスワードをご確認ください。');}};
$('operatorSignOut').onclick=()=>{if(busy){say('処理が終わってから退室してください。');return;}signOut(auth).catch(reportError);};

function renderRoster(){
 $('roster').replaceChildren();
 const query=normalizedName($('rosterSearch').value),filter=$('rosterFilter').value;
 const visible=players.filter(p=>{
  const value={...p,...drafts.get(p.id)};
  return (!query||normalizedName(`${p.id} ${value.name||''}`).includes(query)) &&
   (filter==='all'||(filter==='active'&&value.active&&value.name)||(filter==='unnamed'&&!value.name?.trim())||(filter==='draft'&&drafts.has(p.id)));
 });
 const pages=Math.max(1,Math.ceil(visible.length/6));rosterPage=Math.min(rosterPage,pages-1);
 $('rosterCount').textContent=`${visible.length}人 ／ ${rosterPage+1} / ${pages}ページ（1ページ6人）`;
 $('rosterPrev').disabled=rosterPage===0;$('rosterNext').disabled=rosterPage>=pages-1;
 for(const p of visible.slice(rosterPage*6,rosterPage*6+6)){
  const value={...p,...drafts.get(p.id)};
  const wrapper=document.createElement('details'),summary=document.createElement('summary'),row=document.createElement('article');
  wrapper.className='roster-person';wrapper.open=openRoster.has(p.id);
  summary.textContent=`${p.id}　${value.name||'名前未登録'}　${value.active?'参加':'欠員'}${drafts.has(p.id)?' ／ 未保存':''}`;
  wrapper.ontoggle=()=>{if(wrapper.open)openRoster.add(p.id);else openRoster.delete(p.id);};
  wrapper.append(summary,row);
  row.innerHTML=`<h3>${escape(p.id)}</h3><label>参加<input class="active" type="checkbox" ${value.active?'checked':''}></label><label>登録名<input class="name" maxlength="60" value="${escape(value.name)}"></label><p>${p.assignmentStatus==='unassigned' || !p.name?'チーム未編成・部門未決定（抽選機能は今後追加）':'所属・部門は下の手動設定から確認できます。'}</p><details><summary>所属・部門の手動設定（CSV取り込み時は不要）</summary><label>所属<select class="team">${Object.keys(defaultTeams).map(t=>`<option ${t===value.teamId?'selected':''}>${t}</option>`).join('')}</select></label><div>${divisions.map(d=>`<label><input class="division" type="checkbox" value="${d.id}" ${value.divisions?.includes(d.id)?'checked':''}>${d.name}</label>`).join('')}</div></details><button class="save">この人の設定を保存</button><details><summary>入室コードを確認</summary><code>${escape(p.authUid?`${p.id}-${p.password}`:'準備中')}</code></details><small>${p.assignedRequestUid?'コード配布済み':'未配布'} ／ ${drafts.has(p.id)?'未保存の入力あり':'保存済み'}</small>`;
  if(p.application){
    const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('dl');
    summary.textContent='応募時の回答（運営専用・実力の点数計算は未実施）';
    for(const field of p.application.fields||[]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=field.header;dd.textContent=field.value;dd.style.whiteSpace='pre-wrap';list.append(dt,dd);}
    details.append(summary,list);row.append(details);
  }
  const readValues=()=>({name:row.querySelector('.name').value.trim(),active:row.querySelector('.active').checked,
    teamId:row.querySelector('.team').value,divisions:[...row.querySelectorAll('.division:checked')].map(el=>el.value)});
  const remember=()=>{drafts.set(p.id,{...readValues(),baseFingerprint:drafts.get(p.id)?.baseFingerprint||slotFingerprint(p)});$('rosterDraftNotice').textContent=`未保存の入力：${drafts.size}人分。入力はほかの人を保存しても保持します。CSV取り込み前に保存してください。`;};
  row.addEventListener('input',remember);row.addEventListener('change',remember);
  row.querySelector('.save').onclick=()=>action(row.querySelector('.save'),async()=>{
    const edited=readValues();
    if(edited.active && !edited.name)throw Error('参加者の登録名を入力してください。');
    if(!confirm(`${p.id}の名前・所属・出場部門を保存しますか？ 試合への反映は別のボタンで行います。`))return;
    const expected=drafts.get(p.id)?.baseFingerprint||slotFingerprint(p);
    await fs.runTransaction(db,async tx=>{
      const ref=fs.doc(db,'participants',p.id),snap=await tx.get(ref);
      if(!snap.exists() || slotFingerprint({...snap.data(),id:p.id})!==expected)throw Error('この人の情報がほかの操作で更新されました。入力を控え、画面を読み直して確認してください。');
      tx.update(ref,{...edited,assignmentStatus:p.assignmentStatus==='unassigned' && edited.teamId===p.teamId && !edited.divisions.length?'unassigned':'manual'});
    });
    drafts.delete(p.id);renderRoster();
    say(`${p.id}の設定を保存しました。`);
  });
  $('roster').append(wrapper);
 }
 $('rosterDraftNotice').textContent=drafts.size?`未保存の入力：${drafts.size}人分。CSV取り込み前に保存してください。`:'';
}
$('rosterSearch').oninput=()=>{rosterPage=0;renderRoster();};
$('rosterFilter').onchange=()=>{rosterPage=0;renderRoster();};
$('rosterPrev').onclick=()=>{rosterPage--;renderRoster();};
$('rosterNext').onclick=()=>{rosterPage++;renderRoster();};
function renderRequests(){
 const pending=requests.filter(r=>r.status==='pending');$('pendingBadge').textContent=`🔔 未確認 ${pending.length}件`;
 $('requests').replaceChildren();
 const ordered=[...requests].sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1) || (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
 for(const r of ordered){
  const row=document.createElement('article'),matches=players.filter(p=>p.active && normalizedName(p.name)===normalizedName(r.name));
  const duplicates=requests.filter(x=>x.id!==r.id && normalizedName(x.name)===normalizedName(r.name) && x.status!=='rejected').length;
  row.innerHTML=`<h3>${escape(r.name)}</h3><p>${r.status==='pending'?'確認待ち':r.status==='approved'?'承認済み':'承認しない'}${duplicates?' ／ 同じ名前の申請あり：本人を確認してください':''}</p><small>申請番号：${escape(r.id.slice(0,8))}</small>`;
  if(r.status==='pending'){
    const select=document.createElement('select');select.innerHTML='<option value="">名簿の本人を選択</option>'+players.filter(p=>p.active && p.name && p.authUid).map(p=>`<option value="${p.id}">${escape(`${p.name}（${p.teamId}・${p.id}）${p.assignedRequestUid?'配布済み':''}`)}</option>`).join('');
    if(matches.length===1)select.value=matches[0].id;
    const approve=document.createElement('button');approve.textContent='確認してコードを配布';
    approve.onclick=()=>action(approve,async()=>{
      const p=players.find(p=>p.id===select.value);if(!p)throw Error('名簿から参加者を選んでください。');
      if(!confirm(`申請「${r.name}」を名簿「${p.name}（${p.id}）」本人と確認しましたか？ この申請端末にコードを配布します。`))return;
      await flows.approve(r.id,p.id);say('承認し、申請したブラウザーにコードを配布しました。');
    });
    const reject=document.createElement('button');reject.textContent='承認しない';reject.onclick=()=>action(reject,async()=>{
      if(!confirm('この申請を承認しない状態に変更しますか？'))return;
      await fs.runTransaction(db,async tx=>{const ref=fs.doc(db,'checkins',r.id),snap=await tx.get(ref);if(snap.data()?.status!=='pending')throw Error('この申請は確認済みです。');tx.update(ref,{status:'rejected',updatedAt:fs.serverTimestamp()});});
    });row.append(select,approve,reject);
  }$('requests').append(row);
 }
}
$('prepareSlots').onclick=()=>action($('prepareSlots'),async()=>{
 if(!confirm('本番用の24人分のアカウントとランダムな個別コードをFirebaseに作成しますか？ 既存の本番枠は再利用し、P01〜P04は変更しません。'))return;
 await prepareParticipants(fs,db,{createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut},provisionAuth,
   index=>say(`${index} / 24人目を準備しています。この間は画面を閉じないでください。`));
 say('24人分のコードを準備しました。名前と出場部門は1人ずつ保存してください。');
});
$('reflectMatches').onclick=()=>action($('reflectMatches'),async()=>{
 const snapshot=await fs.getDocs(fs.collection(db,'participants'));
 const planned=planRooms(snapshot.docs.map(d=>({...d.data(),id:d.id})));
 if(!confirm('登録済みの部門分けで24試合を作成・更新しますか？ 未報告・訂正依頼中の試合には代理出場の変更も反映します。'))return;
 await flows.reflectAssignments(planned);say('対戦カードを反映しました。確定済み試合は変更していません。');
});
$('toggleAccepting').onclick=()=>action($('toggleAccepting'),async()=>{
 if(!confirm(accepting?'受付を停止しますか？ 既存の申請と受け取りは残ります。':'チェックイン受付を開始しますか？'))return;
 await fs.setDoc(fs.doc(db,'settings','checkin'),{accepting:!accepting,updatedAt:fs.serverTimestamp()});
});
$('saveTeams').onclick=()=>action($('saveTeams'),async()=>{
 const names=Object.fromEntries([...document.querySelectorAll('[data-team]')].map(el=>[el.dataset.team,el.value.trim()]));
 if(Object.values(names).some(n=>!n))throw Error('4チームすべての表示名を入力してください。');
 if(!confirm('チームの表示名を公開しますか？'))return;
 await fs.setDoc(fs.doc(db,'public','teamNames'),{names});say('チームの表示名を保存しました。');
});
$('publishOverview').onclick=()=>action($('publishOverview'),async()=>{
 if(!confirm('現在の確定スコアとチーム表示名を一般公開画面に反映しますか？ 参加者コードや申請名は公開しません。'))return;
 const snap=await fs.getDocs(fs.collection(db,'rooms'));
 await fs.setDoc(fs.doc(db,'public','overview'),{matches:publicMatches(snap.docs.map(d=>d.data())),updatedAt:fs.serverTimestamp()});say('確定結果を公開画面に反映しました。');
});
