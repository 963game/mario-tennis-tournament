import {divisions} from './tournament.js';
import {pairRounds,publishedMatch} from './competition.js';
import {stableStringify} from './data-utils.js';
export const allCourts=Object.freeze(['スタジアム グラス','スタジアム ハード','スタジアム クレイ','アカデミー グラス','アカデミー ハード','アカデミー クレイ','アカデミー ウッド','アカデミー ブロック','アカデミー カーペット','アカデミー キノコ','アカデミー サンド','アカデミー アイス','飛行船コート','フォレストコート','ワルイージピンボール','ラケットファクトリー','ワンダーコート','ギャラクシーコート']);
export function randomIndex(n){const cap=Math.floor(4294967296/n)*n;let x;do{x=crypto.getRandomValues(new Uint32Array(1))[0];}while(x>=cap);return x%n;}
export function roundSchedule(teams){return divisions.flatMap(d=>pairRounds(teams).map((pairs,i)=>({divisionId:d.id,round:i+1,matchIds:pairs.map(([a,b])=>`${d.id}-r${i+1}-${a}${b}`),pairs})));}
function hostOptions(teams){
 const rounds=pairRounds(teams),edges=rounds.flat(),options=[];let best=Infinity;
 for(let mask=0;mask<2**edges.length;mask++){
  let index=0;const hosts=rounds.map(pairs=>pairs.map(pair=>pair[(mask>>index++)&1]));
  const counts=teams.map(t=>hosts.flat().filter(h=>h===t).length);
  if(counts.some(n=>teams.length===3?n!==1:n<1||n>2))continue;
  const consecutive=hosts.slice(1).reduce((sum,group,i)=>sum+group.filter(t=>hosts[i].includes(t)).length,0);
  if(consecutive<best){best=consecutive;options.length=0;}if(consecutive===best)options.push({hosts,counts,cost:consecutive});
 }return options;
}
export function balancedHosts(teams){
 const options=hostOptions(teams),target=teams.length===3?4:6;let best=Infinity,chosen=null,ties=0;
 function walk(path,counts,cost){
  if(cost>best)return;
  if(path.length===4){if(counts.some(n=>n!==target))return;if(cost<best){best=cost;ties=0;}if(cost===best&&randomIndex(++ties)===0)chosen=path.map(o=>o.hosts.map(h=>[...h]));return;}
  for(const option of options){const next=counts.map((n,i)=>n+option.counts[i]);if(next.some(n=>n>target))continue;
   const previous=path.at(-1)?.hosts.at(-1),extra=previous?option.hosts[0].filter(t=>previous.includes(t)).length:0;walk([...path,option],next,cost+option.cost+extra);
  }
 }
 walk([],teams.map(()=>0),0);if(!chosen)throw Error('部屋立ての均等配分を作成できませんでした。');return chosen.flat();
}
export function courtPool(text){const courts=String(text).split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);if(courts.length<2||courts.length>100||new Set(courts).size!==courts.length||courts.some(c=>c.length>80))throw Error('コート名を重複なしで2〜100件、1行に1件、各80文字以内で入力してください。');return courts;}
export function makeRoundPlan(teams,courts){
 courtPool(courts.join('\n'));const hosts=balancedHosts(teams);let previous='';
 return roundSchedule(teams).map((group,index)=>{const candidates=courts.filter(c=>c!==previous),courtName=candidates[randomIndex(candidates.length)];previous=courtName;
  const {pairs,...storedGroup}=group;
  return {...storedGroup,courtName,hosts:Object.fromEntries(group.matchIds.map((id,i)=>[id,hosts[index][i]]))};
 });
}
export function displaySides(match){return match.hostTeamId===match.teamB?{left:match.teamB,right:match.teamA,leftNames:match.teamBNames||[],rightNames:match.teamANames||[],leftScore:match.scoreB,rightScore:match.scoreA}:{left:match.teamA,right:match.teamB,leftNames:match.teamANames||[],rightNames:match.teamBNames||[],leftScore:match.scoreA,rightScore:match.scoreB};}
export function playState(room){return room.status==='confirmed'?'finished':(room.roundManaged||room.publicReady||room.divisionId)?(room.playState==='active'?'active':'waiting'):'active';}
export async function prepareRoundPlan(api,db,state,courts){
 if(!state?.divisionsPublished)throw Error('先に部門と対戦カードを公開してください。');
 if((state.roundControl?.index??-1)>=0)throw Error('大会開始後は部屋立て・コートの再抽選はできません。');
 const plan=makeRoundPlan(state.teamIds,courts);
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'competition','state'),fresh=(await tx.get(ref)).data();if(stableStringify(fresh)!==stableStringify(state))throw Error('大会設定が更新されました。');
  const ids=plan.flatMap(g=>g.matchIds),snapshots=await Promise.all(ids.map(id=>tx.get(api.doc(db,'rooms',id))));
  for(const snap of snapshots)if(!snap.exists()||snap.data().status!=='unreported')throw Error('未報告以外の試合があるため、進行設定を新規作成できません。');
  for(let i=0;i<ids.length;i++){const room={...snapshots[i].data(),publicReady:true,roundManaged:true,playState:'waiting',courtName:'',hostTeamId:''};tx.update(api.doc(db,'rooms',ids[i]),{publicReady:true,roundManaged:true,playState:'waiting',courtName:'',hostTeamId:'',updatedAt:api.serverTimestamp()});tx.set(api.doc(db,'publicMatches',ids[i]),{...publishedMatch(room),updatedAt:api.serverTimestamp()});}
  tx.set(ref,{...fresh,roundControl:{plan,index:-1,courts:[...courts]},updatedAt:api.serverTimestamp()});
  tx.set(api.doc(db,'public','config'),{teamIds:state.teamIds,divisionsPublished:true,roundManaged:true,roundIndex:-1,currentRound:null,updatedAt:api.serverTimestamp()});
 });
}
export async function startNextRound(api,db,state){
 const control=state?.roundControl;if(!control)throw Error('先にコート・部屋立ての抽選を保存してください。');
 const nextIndex=control.index+1,group=control.plan[nextIndex];if(!group)throw Error('すべてのラウンドを開始済みです。');
 await api.runTransaction(db,async tx=>{
  const stateRef=api.doc(db,'competition','state'),current=(await tx.get(stateRef)).data();if(stableStringify(current)!==stableStringify(state))throw Error('進行状態が更新されました。');
  const previous=control.plan[control.index],previousSnaps=await Promise.all((previous?.matchIds||[]).map(id=>tx.get(api.doc(db,'rooms',id))));
  if(previousSnaps.some(s=>s.data()?.status!=='confirmed'))throw Error('現在のラウンドの全試合を確定してから次を開始してください。');
  const snapshots=await Promise.all(group.matchIds.map(id=>tx.get(api.doc(db,'rooms',id))));
  for(let i=0;i<snapshots.length;i++){
   const before=snapshots[i].data(),id=group.matchIds[i];if(!before)throw Error('対戦カードがありません。');
   if(![before.teamA,before.teamB].includes(group.hosts[id]))throw Error('部屋立て担当が対戦チームと一致しません。');
   const patch={roundManaged:true,playState:'active',courtName:group.courtName,hostTeamId:group.hosts[id]};
   tx.update(api.doc(db,'rooms',id),{...patch,updatedAt:api.serverTimestamp()});tx.set(api.doc(db,'publicMatches',id),{...publishedMatch({...before,...patch}),updatedAt:api.serverTimestamp()});
  }
  tx.set(stateRef,{...current,roundControl:{...control,index:nextIndex},updatedAt:api.serverTimestamp()});
  tx.set(api.doc(db,'public','config'),{teamIds:state.teamIds,divisionsPublished:true,roundManaged:true,roundIndex:nextIndex,currentRound:{divisionId:group.divisionId,round:group.round,courtName:group.courtName},updatedAt:api.serverTimestamp()});
 });
}
