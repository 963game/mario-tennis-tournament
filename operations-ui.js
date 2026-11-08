import {divisions,defaultTeams} from './tournament.js';
import {validScore} from './policy.js';
import {blankSlots,drawDepartments,planDepartmentRooms,saveDepartmentDraft,publishDepartments,standings,publishedMatch,statusNames,downloadCsv} from './competition.js';
import {mountRoundControl} from './round-control-ui.js';
import {displaySides,playState} from './round-control.js';
export function mountOperations({api,db,getPlayers,getDraftCount,getUser,runAction,say}){
 const root=document.getElementById('operationsRoot');let state={},rooms=[],stops=[],chatStop=()=>{},localSlots=null,slotSource=null,page=0;const matchDrafts=new Map(),openMatches=new Set();
 const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const button=(text,fn)=>{const b=el('button',text);b.onclick=()=>runAction(b,fn);return b;};
 const confirmDrafts=()=>{if(getDraftCount())throw Error('名簿の未保存入力を先に保存してください。');};
 const teams=()=>state.teamIds||['A','B','C','D'];
 let filterDivision='',filterStatus='';
 const roundControl=mountRoundControl({api,db,getState:()=>state,getRooms:()=>rooms,runAction,say});
 function render(){
  chatStop();chatStop=()=>{};root.replaceChildren();
  const draw=el('section');draw.id='operationDraw';draw.dataset.area='departments';draw.append(el('h2','当日の部門抽選・代理変更'),el('p',state.divisionsPublished?'部門公開済み。再抽選は禁止です。代理変更は同じチーム内だけ選べます。':'チーム発表後、部門の抽選・確認・保存・公開を行います。'));
  const newDraw=button('部門をランダム抽選',async()=>{confirmDrafts();if(!state.teamsPublished)throw Error('先にチーム名簿を公開してください。');if(state.divisionsPublished)throw Error('公開後は再抽選できません。');if(!confirm('部門の下書きを抽選し直しますか？ まだ公開されません。'))return;localSlots=drawDepartments(getPlayers(),teams());slotSource=structuredClone(getPlayers());render();});newDraw.disabled=!!state.divisionsPublished;draw.append(newDraw);
  draw.append(button(state.divisionsPublished?'公開済みの担当を読み込む':'欠員対応用に手動の部門枠を作る',async()=>{if(!state.teamsPublished)throw Error('先にチーム名簿を公開してください。');if(localSlots&&!confirm('未保存の部門変更を破棄して読み直しますか？'))return;localSlots=structuredClone(state.divisionsPublished?state.publishedSlots:blankSlots(teams()));slotSource=structuredClone(getPlayers());render();}));
  const slots=localSlots||state.departmentDraft?.slots;
  if(slots){
   for(const team of teams()){
    const details=el('details'),summary=el('summary',`${team}チームの担当部門`);details.append(summary);details.open=!!localSlots;
    for(const d of divisions){const line=el('div');line.append(el('strong',d.name));
     for(let i=0;i<d.size;i++){const select=el('select');select.setAttribute('aria-label',`${team} ${d.name} ${i+1}人目`);const empty=el('option','選択してください');empty.value='';select.append(empty);
      for(const p of getPlayers().filter(p=>p.active&&p.name&&p.teamId===team)){const o=el('option',p.name);o.value=p.id;select.append(o);}select.value=slots[team]?.[d.id]?.[i]||'';
      select.onchange=()=>{if(!localSlots){localSlots=structuredClone(slots);slotSource=structuredClone(getPlayers());}localSlots[team][d.id][i]=select.value;document.getElementById('departmentDirty').textContent='未保存の部門変更があります。';};line.append(select);
     }details.append(line);
    }draw.append(details);
   }
   draw.append(el('p',localSlots?'画面に未保存の部門変更があります。':'保存済みの部門下書きです。'));draw.lastChild.id='departmentDirty';
   draw.append(button('部門の下書きを保存（非公開）',async()=>{confirmDrafts();const next=localSlots||slots;if(!confirm('部門の下書きを保存しますか？ 公開済みの場合も代理反映は次のボタンです。'))return;await saveDepartmentDraft(api,db,slotSource||getPlayers(),state,next,{proxy:!!state.divisionsPublished});localSlots=null;slotSource=null;say('部門の下書きを保存しました。次に確認して公開・反映してください。');}));
   draw.append(button(state.divisionsPublished?'代理変更を未確定試合へ反映':'部門を公開して対戦カードを作成',async()=>{confirmDrafts();if(localSlots)throw Error('部門の下書きを先に保存してください。');if(!confirm(state.divisionsPublished?'未確定試合の出場者を変更しますか？ 確定済みの出場者は保持します。':'部門を公開し、正式な対戦カードを作成しますか？ 公開後は再抽選できません。'))return;await publishDepartments(api,db,getPlayers(),state,{proxy:!!state.divisionsPublished});say('部門・対戦カードを反映しました。');}));
  }root.append(draw,roundControl.render());
  const management=el('section');management.id='operationMatches';management.dataset.area='matches';management.append(el('h2','試合管理・結果訂正・チャット'));
  const divisionSelect=el('select'),statusSelect=el('select');for(const [value,text] of [['','全部門'],...divisions.map(d=>[d.id,d.name])]){const o=el('option',text);o.value=value;divisionSelect.append(o);}divisionSelect.value=filterDivision;divisionSelect.onchange=()=>{filterDivision=divisionSelect.value;page=0;render();};
  for(const [value,text] of [['','全状態'],...Object.entries(statusNames)]){const o=el('option',text);o.value=value;statusSelect.append(o);}statusSelect.value=filterStatus;statusSelect.onchange=()=>{filterStatus=statusSelect.value;page=0;render();};management.append(divisionSelect,statusSelect);
  const visible=rooms.filter(r=>(!filterDivision||r.divisionId===filterDivision)&&(!filterStatus||r.status===filterStatus)).sort((a,b)=>divisions.findIndex(d=>d.id===a.divisionId)-divisions.findIndex(d=>d.id===b.divisionId)||a.round-b.round||a.teamA.localeCompare(b.teamA));
  const pages=Math.max(1,Math.ceil(visible.length/6));page=Math.min(page,pages-1);management.append(el('p',`${visible.length}試合 ／ ${page+1} / ${pages}ページ`));
  const prev=el('button','前の6試合'),next=el('button','次の6試合');prev.disabled=page===0;next.disabled=page>=pages-1;prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};management.append(prev,next);
  for(const room of visible.slice(page*6,page*6+6)){
   const sides=displaySides(room),card=el('details'),summary=el('summary',`${room.title}　${sides.left} vs ${sides.right}　${playState(room)==='waiting'?'待機中':statusNames[room.status]||room.status}`);card.open=openMatches.has(room.id);card.ontoggle=()=>{if(card.open)openMatches.add(room.id);else openMatches.delete(room.id);};card.append(summary);
   card.append(el('p',`${sides.leftNames.join('・')} ／ ${sides.rightNames.join('・')}`),el('p',`コート：${room.courtName||'開始時に公開'} ／ 部屋立て：${room.hostTeamId||'開始時に公開'}`));
   const a=el('input'),b=el('input'),reason=el('input');a.type=b.type='number';a.min=b.min='0';a.max=b.max='99';a.value=matchDrafts.get(room.id)?.a??room.scoreA;b.value=matchDrafts.get(room.id)?.b??room.scoreB;a.setAttribute('aria-label','A側スコア');b.setAttribute('aria-label','B側スコア');reason.placeholder='確定・訂正の理由（必須）';reason.maxLength=300;reason.value=matchDrafts.get(room.id)?.reason||'';for(const input of [a,b,reason])input.oninput=()=>matchDrafts.set(room.id,{a:a.value,b:b.value,reason:reason.value,expected:matchDrafts.get(room.id)?.expected||{updatedAt:room.updatedAt,status:room.status,scoreA:room.scoreA,scoreB:room.scoreB}});card.append(a,b,reason);
   a.placeholder=`${room.teamA}チームのスコア`;b.placeholder=`${room.teamB}チームのスコア`;a.className='operator-score-a';b.className='operator-score-b';if(room.hostTeamId===room.teamB){b.before(a);a.before(b);}
   card.append(button('入力を破棄して最新結果を表示',async()=>{if(!confirm('この試合の未保存入力を破棄しますか？'))return;matchDrafts.delete(room.id);render();}));
   card.append(button('運営として結果を確定・訂正',async()=>{
    const av=Number(a.value),bv=Number(b.value),note=reason.value.trim();if(!a.value||!b.value||!validScore(av,bv)||!note)throw Error('異なる0〜99の整数と理由を入力してください。');
    const display=displaySides({...room,scoreA:av,scoreB:bv});if(!confirm(`${display.left} ${display.leftScore} − ${display.rightScore} ${display.right}で確定しますか？ 公開結果と順位に即時反映します。`))return;
    await api.runTransaction(db,async tx=>{
     const ref=api.doc(db,'rooms',room.id),snap=await tx.get(ref),before=snap.data();
     const expected=matchDrafts.get(room.id)?.expected||room;
     if(!before||JSON.stringify(before.updatedAt)!==JSON.stringify(expected.updatedAt)||before.status!==expected.status||before.scoreA!==expected.scoreA||before.scoreB!==expected.scoreB)throw Error('試合情報が更新されました。入力を控えて「入力を破棄して最新結果を表示」から確認してください。');
     const after={...before,status:'confirmed',scoreA:av,scoreB:bv,approvedBy:getUser().uid,updatedAt:api.serverTimestamp()};
     tx.update(ref,{status:'confirmed',scoreA:av,scoreB:bv,approvedBy:getUser().uid,updatedAt:api.serverTimestamp()});
     if(before.publicReady)tx.set(api.doc(db,'publicMatches',room.id),{...publishedMatch(after),updatedAt:api.serverTimestamp()});
     tx.set(api.doc(api.collection(db,'rooms',room.id,'history')),{before:{status:before.status,scoreA:before.scoreA,scoreB:before.scoreB},after:{scoreA:av,scoreB:bv},reason:note,operatorUid:getUser().uid,at:api.serverTimestamp()});
    });matchDrafts.delete(room.id);render();say('結果を確定・訂正しました。公開順位も自動で再計算されます。');
   }));
   const chat=el('div');card.append(button('この試合のチャットを開く（最新100件）',async()=>{chatStop();chatStop=api.onSnapshot(api.query(api.collection(db,'rooms',room.id,'chat'),api.orderBy('at','desc'),api.limit(100)),snapshot=>{chat.replaceChildren();for(const m of [...snapshot.docs].reverse()){const d=m.data();chat.append(el('p',`${d.name||'参加者'}：${d.body}`));}},e=>say('チャットを取得できません。通信と権限をご確認ください。'));}));
   card.append(button('チャットの全履歴を読み込む',async()=>{const snap=await api.getDocs(api.collection(db,'rooms',room.id,'chat'));chat.replaceChildren();for(const m of snap.docs.sort((a,b)=>(a.data().at?.seconds||0)-(b.data().at?.seconds||0))){const d=m.data();chat.append(el('p',`${d.name||'参加者'}：${d.body}`));}}));
   card.append(button('運営の訂正履歴を見る',async()=>{const snap=await api.getDocs(api.collection(db,'rooms',room.id,'history'));chat.replaceChildren();for(const h of snap.docs.sort((a,b)=>(a.data().at?.seconds||0)-(b.data().at?.seconds||0))){const d=h.data();chat.append(el('p',`${d.before.scoreA}−${d.before.scoreB} → ${d.after.scoreA}−${d.after.scoreB}：${d.reason}`));}if(snap.empty)chat.append(el('p','運営の訂正履歴はありません。'));}));card.append(chat);
   const operatorMessage=el('input');operatorMessage.placeholder='運営からのメッセージ';operatorMessage.maxLength=300;card.append(operatorMessage,button('運営としてチャット送信',async()=>{const body=operatorMessage.value.trim();if(!body||body.length>300)throw Error('1〜300文字で入力してください。');await api.addDoc(api.collection(db,'rooms',room.id,'chat'),{uid:getUser().uid,name:'運営',body,at:api.serverTimestamp()});operatorMessage.value='';say('運営メッセージを送信しました。');}));management.append(card);
  }root.append(management);
  const data=el('section');data.id='operationData';data.dataset.area='data';data.append(el('h2','CSV出力・大会データ初期化'));
  data.append(button('総合順位CSVを保存',async()=>{const results=standings(rooms,teams()),snapshot=await api.getDoc(api.doc(db,'public','teamNames')),names={...defaultTeams,...snapshot.data()?.names};downloadCsv('大会順位.csv',['順位','チーム','勝利数','敗戦数','試合数','得ゲーム','失ゲーム','得失差'],results.map(r=>[r.rank,names[r.teamId],r.wins,r.losses,r.played,r.gamesFor,r.gamesAgainst,r.difference]));}));
  data.append(button('試合結果CSVを保存',async()=>{const snapshot=await api.getDoc(api.doc(db,'public','teamNames')),names={...defaultTeams,...snapshot.data()?.names};downloadCsv('大会試合結果.csv',['部門','ラウンド','チームA','チームB','状態','スコアA','スコアB'],rooms.map(r=>[divisions.find(d=>d.id===r.divisionId)?.name,r.round,names[r.teamA],names[r.teamB],statusNames[r.status],r.status==='confirmed'?r.scoreA:'',r.status==='confirmed'?r.scoreB:'']));}));
  const reset=el('details');reset.append(el('summary','大会データの全削除（取り消し不可）'),el('p','参加者名簿・評価・コード・申請・配布先・試合・チャット・公開データ・テスト試合を削除します。サイト本体と運営アカウントは残します。Firebase Authenticationの参加者アカウントは最後にFirebase管理画面で削除が必要です。'));
  const input=el('input');input.placeholder='大会データを全削除';reset.append(input,button('削除対象を確認して実行',async()=>{
   if(input.value!=='大会データを全削除')throw Error('確認欄へ「大会データを全削除」と正確に入力してください。');
   const names=['participants','participantAccess','checkins','deliveries','rooms','publicMatches','public','competition'];const snapshots=await Promise.all(names.map(name=>api.getDocs(api.collection(db,name))));
   if(!confirm(snapshots.map((s,i)=>`${names[i]}：${s.size}件`).join('\n')+'\n各試合のチャット・訂正履歴も削除します。続けますか？'))return;
   await api.setDoc(api.doc(db,'competition','maintenance'),{resetting:true,updatedAt:api.serverTimestamp()});
   await api.setDoc(api.doc(db,'settings','checkin'),{accepting:false,updatedAt:api.serverTimestamp()});
   for(const room of snapshots[4].docs)for(const sub of ['chat','history'])await deleteCollection(api.collection(db,'rooms',room.id,sub));
   for(const name of names)await deleteCollection(api.collection(db,name));
   say('Firestoreの大会データを削除しました。最後にFirebase Authenticationで参加者の @players.invalid アカウントと匿名の受付アカウントを削除してください。運営アカウントは残してください。');
  }));data.append(reset);root.append(data);
 }
 async function deleteCollection(ref){let count=0;while(true){const snap=await api.getDocs(api.query(ref,api.limit(150)));if(snap.empty)return;const batch=api.writeBatch(db);for(const d of snap.docs)batch.delete(d.ref);await batch.commit();count+=snap.size;say(`${count}件を削除中です。画面を閉じないでください。`);}}
 return {refresh:render,start(){stops.push(api.onSnapshot(api.doc(db,'competition','state'),s=>{state=s.data()||{};render();},()=>say('大会設定を取得できません。新しいFirestoreルールが必要です。')));stops.push(api.onSnapshot(api.collection(db,'rooms'),s=>{rooms=s.docs.map(d=>({...d.data(),id:d.id})).filter(r=>divisions.some(d=>d.id===r.divisionId));render();},()=>say('試合情報を取得できません。')));},clear(){stops.forEach(s=>s());stops=[];chatStop();root.replaceChildren();state={};rooms=[];localSlots=null;slotSource=null;matchDrafts.clear();openMatches.clear();roundControl.clear();}};
}
