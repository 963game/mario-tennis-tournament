import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged,setPersistence,browserSessionPersistence} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import * as fs from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {divisions,defaultTeams} from './tournament.js';
import {canReport,canReview,validScore,participantCredential,sameReport} from './policy.js';
import {standings,publishedMatch,statusNames,pairRounds} from './competition.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=fs.getFirestore(app);
let names={...defaultTeams},config={teamIds:['A','B','C','D'],divisionsPublished:false},publicRooms=[],publicTeams=null,selectedDivision=divisions[0].id;
let roomStop=()=>{},chatStops=[],identity=null,authVersion=0;const inputs=new Map();
const say=text=>$('notice').textContent=text;
const fail=e=>say(e?.code?.startsWith('auth/')?'入室できません。配布コードと通信状況をご確認ください。':e?.code==='permission-denied'?'閲覧・操作が許可されていません。運営にお問い合わせください。':e?.message&&!e?.code?e.message:'情報を取得できません。通信を確認し、直らない場合は運営にお知らせください。');
function go(tab){document.querySelectorAll('.pane').forEach(p=>p.hidden=p.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===tab));});}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));go('progress');
function cleanPrivate(){roomStop();chatStops.forEach(s=>s());chatStops=[];$('rooms').replaceChildren();}
function renderPublic(){
 const teams=config.teamIds?.length?config.teamIds:['A','B','C','D'];
 $('eventFormat').textContent=`${teams.length}チーム / 4部門 / ${teams.length===3?'12':'24'}試合`;
 $('completedCount').textContent=`${publicRooms.filter(r=>r.status==='confirmed').length} / ${teams.length===3?12:24}`;
 const board=$('standings');board.replaceChildren();
 const table=el('table'),head=el('tr');for(const text of ['順位','チーム','勝利','得失差','確定試合'])head.append(el('th',text));table.append(head);
 for(const r of standings(publicRooms,teams)){const row=el('tr');for(const value of [r.rank,names[r.teamId]||r.teamId,r.wins,r.difference>0?'+'+r.difference:r.difference,r.played])row.append(el('td',String(value)));table.append(row);}board.append(table);
 const tabs=$('divisionTabs');tabs.replaceChildren();for(const d of divisions){const b=el('button',d.name);b.className='division-tab';b.setAttribute('aria-pressed',String(d.id===selectedDivision));b.onclick=()=>{selectedDivision=d.id;renderPublic();};tabs.append(b);}
 const results=$('publicResults');results.replaceChildren();
 if(!config.divisionsPublished)results.append(el('p','対戦部門・カードは発表待ちです。'));
 else for(const [index,pairs] of pairRounds(teams).entries()){
  const block=el('section');block.className='round';block.append(el('h3',`第${index+1}ラウンド`));
  for(const [a,b] of pairs){const match=publicRooms.find(r=>r.divisionId===selectedDivision&&r.round===index+1&&r.teamA===a&&r.teamB===b),card=el('article');card.className='public-match';card.append(el('strong',`${names[a]} vs ${names[b]}`));
   if(match){card.append(el('p',`${(match.teamANames||[]).join('・')} ／ ${(match.teamBNames||[]).join('・')}`),el('span',statusNames[match.status]||'未報告'));if(match.status==='confirmed')card.append(el('b',`${match.scoreA} − ${match.scoreB}`));}
   else card.append(el('p','カードを準備しています'));block.append(card);
  }results.append(block);
 }
 const roster=$('publicTeams');roster.replaceChildren();
 if(!Array.isArray(publicTeams?.teams)){roster.append(el('p',publicTeams?.summary||'チーム発表をお待ちください。'));}
 else for(const team of publicTeams.teams){const card=el('section');card.className='team-card';card.dataset.team=team.teamId;card.append(el('h3',names[team.teamId]||team.teamId));
  for(const member of team.members){const p=el('p',member.name);const label=el('small',publicTeams.divisionsPublished?(member.divisions||[]).map(id=>divisions.find(d=>d.id===id)?.name||'').join(' / '):'担当部門は大会当日に発表');p.append(label);card.append(p);}roster.append(card);
 }
 $('roundGuide').textContent=teams.length===3?'各部門は3ラウンド・各ラウンド1試合。待機チームがあります。':'各部門は3ラウンド。各ラウンド2試合同時進行です。';
 document.querySelectorAll('.private-team-heading').forEach(node=>node.textContent=`${names[node.dataset.teamA]||node.dataset.teamA} vs ${names[node.dataset.teamB]||node.dataset.teamB}`);
}
fs.onSnapshot(fs.doc(db,'public','teamNames'),s=>{names={...defaultTeams,...s.data()?.names};renderPublic();},fail);
fs.onSnapshot(fs.doc(db,'public','config'),s=>{config={teamIds:['A','B','C','D'],divisionsPublished:false,...s.data()};renderPublic();},fail);
fs.onSnapshot(fs.doc(db,'public','teams'),s=>{publicTeams=s.data();renderPublic();},fail);
fs.onSnapshot(fs.collection(db,'publicMatches'),s=>{publicRooms=s.docs.map(d=>({...d.data(),id:d.id}));renderPublic();},fail);
fs.onSnapshot(fs.doc(db,'public','eventInfo'),s=>{const info=s.data()||{};$('eventTitleText').textContent=info.title||'Mario Tennis Fever';$('eventSubtitleText').textContent=info.subtitle||'チーム対抗エキシビジョンマッチ';$('eventAnnouncementText').textContent=info.announcement||'';$('eventAnnouncementText').hidden=!info.announcement;},fail);
await setPersistence(auth,browserSessionPersistence);
onAuthStateChanged(auth,async user=>{
 const version=++authVersion;cleanPrivate();inputs.clear();identity=null;$('who').textContent='未入室';
 if(!user){say('結果やチームは、入室せずにご覧いただけます。');return;}
 try{
  const test=/^p0[1-4]@players\.invalid$/.test(user.email||'');
  const access=await fs.getDoc(fs.doc(db,'participantAccess',user.uid));if(version!==authVersion)return;
  if(!test&&!access.data()?.active){say('このコードはまだ有効化されていないか、参加登録が解除されています。運営にお問い合わせください。');return;}
  identity=access.data()||{name:'テスト参加者',participantId:user.email.split('@')[0].toUpperCase()};$('who').textContent=`入室中：${identity.name}`;say('入室しました。自分の対戦カードを表示します。');
  roomStop=fs.onSnapshot(fs.query(fs.collection(db,'rooms'),fs.where('memberUids','array-contains',user.uid)),s=>{
   const stored=[...$('rooms').querySelectorAll('[data-room]')];for(const card of stored)inputs.set(card.dataset.room,{a:card.querySelector('.a').value,b:card.querySelector('.b').value,body:card.querySelector('.body').value});
   chatStops.forEach(stop=>stop());chatStops=[];$('rooms').replaceChildren();
   if(s.empty)$('rooms').append(el('p','あなたの対戦カードはまだ発表されていません。'));
   const own=s.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>divisions.findIndex(d=>d.id===a.divisionId)-divisions.findIndex(d=>d.id===b.divisionId)||a.round-b.round);
   for(const room of own)renderRoom(room,user.uid);
  },fail);
 }catch(e){if(version===authVersion)fail(e);}
});
$('login').onclick=async()=>{const button=$('login');button.disabled=true;try{const code=participantCredential($('code').value);await signInWithEmailAndPassword(auth,code.email,code.password);$('code').value='';}catch(e){fail(e);}finally{button.disabled=false;}};
$('logout').onclick=()=>signOut(auth).catch(fail);
function renderRoom(room,uid){
 const card=el('section');card.dataset.room=room.id;card.className='private-match';const heading=el('h4',`${names[room.teamA]||room.teamA} vs ${names[room.teamB]||room.teamB}`);heading.className='private-team-heading';heading.dataset.teamA=room.teamA;heading.dataset.teamB=room.teamB;card.append(el('h3',room.title||'動作確認試合'),heading);
 card.append(el('p',`${(room.teamANames||[]).join('・')} ／ ${(room.teamBNames||[]).join('・')}`),el('p',`状態：${statusNames[room.status]||'状態不明'}`));
 if(room.status!=='unreported')card.append(el('p',`報告スコア：${room.scoreA} − ${room.scoreB}`));
 const inputRow=el('div');inputRow.className='row';const a=el('input'),b=el('input');a.className='a';b.className='b';a.type=b.type='number';a.min=b.min=0;a.max=b.max=99;a.placeholder=names[room.teamA];b.placeholder=names[room.teamB];a.setAttribute('aria-label',`${names[room.teamA]}のスコア`);b.setAttribute('aria-label',`${names[room.teamB]}のスコア`);a.value=inputs.get(room.id)?.a||'';b.value=inputs.get(room.id)?.b||'';
 const report=el('button','結果を報告'),approve=el('button','この結果を承認'),fix=el('button','訂正を依頼');report.disabled=!canReport(room,uid);approve.disabled=fix.disabled=!canReview(room,uid);inputRow.append(a,b,report,approve,fix);card.append(inputRow);
 const ref=fs.doc(db,'rooms',room.id);
 async function change(status){
  const av=Number(a.value),bv=Number(b.value);if(status==='pending'&&(!a.value||!b.value||!validScore(av,bv)))throw Error('異なる0〜99の整数でスコアを入力してください。');
  await fs.runTransaction(db,async tx=>{
   const s=await tx.get(ref),current=s.data();if(!current)throw Error('この対戦カードは削除されました。');
   if(status==='pending'){
    if(!canReport(current,uid)||JSON.stringify(current.updatedAt)!==JSON.stringify(room.updatedAt))throw Error('試合が更新されました。最新の内容を確認してください。');
   }else if(!canReview(current,uid)||!sameReport(room,current))throw Error('報告が更新されました。最新のスコアを確認してください。');
   const patch=status==='pending'?{scoreA:av,scoreB:bv,status,reportedBy:uid,approvedBy:''}:{status,approvedBy:status==='confirmed'?uid:''};
   tx.update(ref,{...patch,updatedAt:fs.serverTimestamp()});
   if(current.publicReady)tx.update(fs.doc(db,'publicMatches',room.id),{...publishedMatch({...current,...patch}),updatedAt:fs.serverTimestamp()});
  });
 }
 const run=async(button,status)=>{button.disabled=true;try{await change(status);}catch(e){fail(e);button.disabled=false;}};
 report.onclick=()=>run(report,'pending');approve.onclick=()=>{if(confirm(`${room.scoreA} − ${room.scoreB}を承認しますか？ 結果と順位が公開されます。`))run(approve,'confirmed');};fix.onclick=()=>run(fix,'needs_fix');
 card.append(el('h4','この試合のチャット'));const messages=el('div');messages.className='messages';card.append(messages);
 const body=el('input');body.className='body';body.maxLength=300;body.placeholder='メッセージ';body.value=inputs.get(room.id)?.body||'';const send=el('button','送信');
 send.onclick=async()=>{send.disabled=true;try{const text=body.value.trim();if(!text||text.length>300)throw Error('1〜300文字で入力してください。');await fs.addDoc(fs.collection(db,'rooms',room.id,'chat'),{uid,name:identity.name,body:text,at:fs.serverTimestamp()});body.value='';}catch(e){fail(e);}finally{send.disabled=false;}};
 const line=el('div');line.className='row';line.append(body,send);card.append(line);$('rooms').append(card);
 chatStops.push(fs.onSnapshot(fs.query(fs.collection(db,'rooms',room.id,'chat'),fs.orderBy('at','desc'),fs.limit(100)),s=>{messages.replaceChildren();for(const item of [...s.docs].reverse()){const d=item.data();messages.append(el('p',`${d.name||'参加者'}：${d.body}`));}},fail));
}
