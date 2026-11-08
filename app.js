import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged,setPersistence,browserSessionPersistence} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import * as fs from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {divisions,defaultTeams} from './tournament.js';
import {canReport,canReview,validScore,participantCredential,sameReport} from './policy.js';
import {standings,publishedMatch,statusNames,pairRounds} from './competition.js';
import {displaySides,playState} from './round-control.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=fs.getFirestore(app);
let names={...defaultTeams},config={teamIds:['A','B','C','D'],divisionsPublished:false},publicRooms=[],publicTeams=null,selectedDivision=divisions[0].id;
let roomStop=()=>{},chatStops=[],identity=null,authVersion=0,ownRooms=[];const inputs=new Map();
const say=text=>$('notice').textContent=text;
const fail=e=>say(e?.code?.startsWith('auth/')?'入室できません。配布コードと通信状況をご確認ください。':e?.code==='permission-denied'?'閲覧・操作が許可されていません。運営にお問い合わせください。':e?.message&&!e?.code?e.message:'情報を取得できません。通信を確認し、直らない場合は運営にお知らせください。');
function go(tab){document.querySelectorAll('.pane').forEach(p=>p.hidden=p.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===tab));});}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));go('progress');
function cleanPrivate(){roomStop();chatStops.forEach(s=>s());chatStops=[];ownRooms=[];$('rooms').replaceChildren();$('playerStage').textContent='';}
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
  const group=publicRooms.filter(r=>r.divisionId===selectedDivision&&r.round===index+1);block.append(el('p',`コート：${group.find(r=>r.courtName)?.courtName||'ラウンド開始時に公開'}`));
  for(const [a,b] of pairs){const match=publicRooms.find(r=>r.divisionId===selectedDivision&&r.round===index+1&&r.teamA===a&&r.teamB===b),card=el('article'),sides=displaySides(match||{teamA:a,teamB:b});card.className='public-match';card.append(el('strong',`${names[sides.left]} vs ${names[sides.right]}`));
   if(match){card.append(el('p',`${sides.leftNames.join('・')} ／ ${sides.rightNames.join('・')}`),el('span',match.status==='unreported'&&playState(match)==='waiting'?'待機中':statusNames[match.status]||'未報告'));if(match.status==='confirmed')card.append(el('b',`${sides.leftScore} − ${sides.rightScore}`));}
   else card.append(el('p','カードを準備しています'));block.append(card);
  }results.append(block);
 }
 const roster=$('publicTeams');roster.replaceChildren();
 if(!Array.isArray(publicTeams?.teams)){roster.append(el('p',publicTeams?.summary||'チーム発表をお待ちください。'));}
 else for(const team of publicTeams.teams){const card=el('section');card.className='team-card';card.dataset.team=team.teamId;card.append(el('h3',names[team.teamId]||team.teamId));
  for(const member of team.members){const p=el('p',member.name);const label=el('small',publicTeams.divisionsPublished?(member.divisions||[]).map(id=>divisions.find(d=>d.id===id)?.name||'').join(' / '):'担当部門は大会当日に発表');p.append(label);card.append(p);}roster.append(card);
 }
 $('roundGuide').textContent=teams.length===3?'各部門は3ラウンド・各ラウンド1試合。待機チームがあります。':'各部門は3ラウンド。各ラウンド2試合同時進行です。';
 const current=config.currentRound,currentMatches=current?publicRooms.filter(r=>r.divisionId===current.divisionId&&r.round===current.round):[];
 const stage=$('tournamentStage');stage.replaceChildren();stage.append(el('h2','現在の対戦カード'));
 if(current){
  const complete=currentMatches.length&&currentMatches.every(r=>r.status==='confirmed');
  stage.append(el('p',`${complete?(config.roundIndex===11?'全ラウンド終了':'ラウンド終了・次の開始待ち'):'現在進行中'}：${divisions.find(d=>d.id===current.divisionId)?.name} 第${current.round}ラウンド`));
  stage.append(el('p',`コート：${current.courtName}`));
  const grid=el('div');grid.className='current-match-grid';
  for(const match of currentMatches){const sides=displaySides(match),card=el('article');card.className='public-match current-match';card.dataset.currentMatch=match.id;
   for(const [team,players] of [[sides.left,sides.leftNames],[sides.right,sides.rightNames]]){card.append(el('h3',names[team]||team),el('p',players.join('・')||'参加者を確認中'));}
   card.append(el('p',`コート：${match.courtName||current.courtName}`),el('span',statusNames[match.status]||'未報告'));grid.append(card);
  }stage.append(grid);
 }else stage.append(el('p',config.divisionsPublished?'ラウンドの開始待ちです。コートは開始時に表示されます。':'チーム・部門の発表をお待ちください。'));
 renderPlayerBanner();
 document.querySelectorAll('.private-team-heading').forEach(node=>node.textContent=`${names[node.dataset.teamA]||node.dataset.teamA} vs ${names[node.dataset.teamB]||node.dataset.teamB}`);
}
fs.onSnapshot(fs.doc(db,'public','teamNames'),s=>{names={...defaultTeams,...s.data()?.names};renderPublic();},fail);
fs.onSnapshot(fs.doc(db,'public','config'),s=>{config={teamIds:['A','B','C','D'],divisionsPublished:false,...s.data()};renderPublic();if(identity)renderPrivateRooms();},fail);
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
   ownRooms=s.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>divisions.findIndex(d=>d.id===a.divisionId)-divisions.findIndex(d=>d.id===b.divisionId)||a.round-b.round);renderPrivateRooms();
  },fail);
 }catch(e){if(version===authVersion)fail(e);}
});
$('login').onclick=async()=>{const button=$('login');button.disabled=true;try{const code=participantCredential($('code').value);await signInWithEmailAndPassword(auth,code.email,code.password);$('code').value='';}catch(e){fail(e);}finally{button.disabled=false;}};
$('logout').onclick=()=>signOut(auth).catch(fail);
function renderPlayerBanner(){
 if(!identity)return;const current=config.currentRound,active=ownRooms.find(r=>playState(r)==='active');
 if(active){const sides=displaySides(active),intro=active.status==='pending'?'結果報告済み・相手チームの確認待ち':active.status==='needs_fix'?'訂正依頼あり・スコアを確認して再報告してください':'対戦開始';$('playerStage').textContent=`${intro}：${active.title} ／ ${names[sides.left]} vs ${names[sides.right]} ／ コート：${active.courtName||'確認中'}。部屋立て：${names[active.hostTeamId]||'運営に確認'}。`;return;}
 const next=ownRooms.find(r=>playState(r)==='waiting');
 const done=current&&ownRooms.some(r=>r.divisionId===current.divisionId&&r.round===current.round&&r.status==='confirmed');
 $('playerStage').textContent=next?`${done?'このラウンドの試合は終了しました。':''}待機中：次の出場は${next.title}です。開始時にコートと部屋立て担当が表示されます。`:ownRooms.length?'あなたの試合は終了しています。試合進捗から大会の状況をご覧ください。':'対戦カードの発表待ちです。';
}
function renderPrivateRooms(){
 if(!identity)return;for(const card of $('rooms').querySelectorAll('[data-room]'))inputs.set(card.dataset.room,{a:card.querySelector('.a').value,b:card.querySelector('.b').value,body:card.querySelector('.body').value});
 chatStops.forEach(s=>s());chatStops=[];$('rooms').replaceChildren();renderPlayerBanner();
 const future=el('details'),past=el('details');future.append(el('summary','今後の自分の試合（待機中）'));past.append(el('summary','終了した自分の試合'));
 for(const room of ownRooms){const state=playState(room);renderRoom(room,auth.currentUser.uid,state==='waiting'?future:state==='finished'?past:$('rooms'));}
 if(future.querySelector('[data-room]'))$('rooms').append(future);if(past.querySelector('[data-room]'))$('rooms').append(past);
}
function renderRoom(room,uid,parent){
 const sides=displaySides(room),state=playState(room),card=el('section');card.dataset.room=room.id;card.className='private-match';const heading=el('h4',`${names[sides.left]} vs ${names[sides.right]}`);heading.className='private-team-heading';heading.dataset.teamA=sides.left;heading.dataset.teamB=sides.right;card.append(el('h3',room.title||'動作確認試合'),heading);
 card.append(el('p',`${sides.leftNames.join('・')} ／ ${sides.rightNames.join('・')}`),el('p',state==='waiting'?'待機中：運営の開始をお待ちください。':`状態：${statusNames[room.status]||'状態不明'}`),el('p',`コート：${room.courtName||'ラウンド開始時に公開'}`));
 if(room.hostTeamId){card.append(el('p',`部屋立て：${names[room.hostTeamId]}（左側）。担当チームで部屋を作成し、合流方法を試合チャットで共有してください。`));}else card.append(el('p','部屋立て担当はラウンド開始時に公開されます。'));
 if(room.status!=='unreported')card.append(el('p',`報告スコア：${sides.leftScore} − ${sides.rightScore}`));
 const inputRow=el('div');inputRow.className='row';const a=el('input'),b=el('input');a.className='a';b.className='b';a.type=b.type='number';a.min=b.min=0;a.max=b.max=99;a.placeholder=names[room.teamA];b.placeholder=names[room.teamB];a.setAttribute('aria-label',`${names[room.teamA]}のスコア`);b.setAttribute('aria-label',`${names[room.teamB]}のスコア`);a.value=inputs.get(room.id)?.a||'';b.value=inputs.get(room.id)?.b||'';
 const report=el('button','結果を報告'),approve=el('button','この結果を承認'),fix=el('button','訂正を依頼');report.disabled=!canReport(room,uid);approve.disabled=fix.disabled=!canReview(room,uid);a.disabled=b.disabled=state!=='active';inputRow.append(...(room.hostTeamId===room.teamB?[b,a]:[a,b]),report,approve,fix);card.append(inputRow);
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
 report.onclick=()=>run(report,'pending');approve.onclick=()=>{if(confirm(`${names[sides.left]} ${sides.leftScore} − ${sides.rightScore} ${names[sides.right]}を承認しますか？ 結果と順位が公開されます。`))run(approve,'confirmed');};fix.onclick=()=>run(fix,'needs_fix');
 card.append(el('h4','この試合のチャット'));const messages=el('div');messages.className='messages';card.append(messages);
 const body=el('input');body.className='body';body.maxLength=300;body.placeholder='メッセージ';body.value=inputs.get(room.id)?.body||'';const send=el('button','送信');
 send.onclick=async()=>{send.disabled=true;try{const text=body.value.trim();if(!text||text.length>300)throw Error('1〜300文字で入力してください。');await fs.addDoc(fs.collection(db,'rooms',room.id,'chat'),{uid,name:identity.name,body:text,at:fs.serverTimestamp()});body.value='';}catch(e){fail(e);}finally{send.disabled=false;}};
 const line=el('div');line.className='row';line.append(body,send);card.append(line);parent.append(card);
 chatStops.push(fs.onSnapshot(fs.query(fs.collection(db,'rooms',room.id,'chat'),fs.orderBy('at','desc'),fs.limit(100)),s=>{messages.replaceChildren();for(const item of [...s.docs].reverse()){const d=item.data();messages.append(el('p',`${d.name||'参加者'}：${d.body}`));}},fail));
}
