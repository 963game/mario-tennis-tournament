import {divisions} from './tournament.js';
import {teamPublicData} from './competition.js';
import {stableStringify} from './data-utils.js';
export const teamFingerprint=p=>stableStringify([p.id,p.name,p.active,p.authUid,p.teamId,p.divisions,p.application||null,p.assessment||null,p.teamEvaluation||null,p.teamDraft||null]);
export const evaluationSource=p=>stableStringify([p.name,p.application||null,p.assessment||null]);
export function confirmedRatings(p){
 const review=p.teamEvaluation;
 if(!review||review.source!==evaluationSource(p)||!Array.isArray(review.ratings)||review.ratings.length!==4||review.ratings.some(x=>!Number.isInteger(x)||x<0||x>4))throw Error(`${p.name}：配分前に運営の評価確認・保存が必要です。`);
 return review.ratings;
}
export async function saveEvaluations(api,db,players,values){
 const people=draftRoster(players);
 if(!people.length)throw Error('名前登録済みの参加者がいません。');
 const updates=people.map(p=>{
  const value=values[p.id];
  if(!value||!Array.isArray(value.ratings)||value.ratings.length!==4||value.ratings.some(x=>!Number.isInteger(x)||x<0||x>4))throw Error(`${p.name}：４部門すべての評価を選択してください。`);
  if(typeof value.note!=='string'||value.note.length>1000)throw Error('修正理由・メモは1000文字以内で入力してください。');
  return {p,review:{ratings:[...value.ratings],note:value.note.trim(),source:evaluationSource(p)}};
 });
 await api.runTransaction(db,async tx=>{
  const snapshots=await Promise.all(updates.map(({p})=>tx.get(api.doc(db,'participants',p.id))));
  for(let i=0;i<updates.length;i++)if(!snapshots[i].exists()||teamFingerprint({...snapshots[i].data(),id:updates[i].p.id})!==teamFingerprint(updates[i].p))throw Error('名簿・評価が更新されました。入力を控え、最新の情報で確認してください。');
  for(const {p,review} of updates)tx.update(api.doc(db,'participants',p.id),{teamEvaluation:review,teamEvaluationUpdatedAt:api.serverTimestamp()});
 });
 return Object.fromEntries(updates.map(({p,review})=>[p.id,review]));
}
export function draftRoster(players){return players.filter(p=>/^P1(?:0[1-9]|1[0-9]|2[0-4])$/.test(p.id)&&p.active&&p.name?.trim());}
export function questionnaireRatings(person,{allowUnknown=false}={}){
 return divisions.map(d=>{
  const fields=(person.application?.fields||[]).filter(f=>String(f.header).normalize('NFKC').includes(d.name.normalize('NFKC')));
  if(fields.length!==1){if(allowUnknown)return null;throw Error(`${person.name}：${d.name}の自己評価を一意に確認できません。応募回答を確認してください。`);}
  const value=String(fields[0].value).trim();
  if(/^(やったことがない|やったことない|未経験)(?:$|[：:])/u.test(value))return 0;
  const score=({'◎':4,'○':3,'〇':3,'◯':3,'▲':2,'×':1,'✕':1})[value[0]];
  if(score===undefined){if(allowUnknown)return null;throw Error(`${person.name}：${d.name}の自己評価が未回答または不明です。`);}
  return score;
 });
}
function randomIndex(n){
 const limit=Math.floor(4294967296/n)*n,buffer=new Uint32Array(1);let x;
 do{x=crypto.getRandomValues(buffer)[0];}while(x>=limit);return x%n;
}
export function suggestTeams(players){
 const people=draftRoster(players),teams=people.length===18?['A','B','C']:['A','B','C','D'];
 if(![18,24].includes(people.length))throw Error('自動配分は名前登録済みの参加者18人または24人で行います。');
 const rated=people.map(p=>({id:p.id,ratings:confirmedRatings(p)}));
 let best=null,bestCost=Infinity;
 for(let attempt=0;attempt<1200;attempt++){
  const sorted=rated.map(p=>({...p,tie:crypto.getRandomValues(new Uint32Array(1))[0]})).sort((a,b)=>b.ratings.reduce((x,y)=>x+y,0)-a.ratings.reduce((x,y)=>x+y,0)||a.tie-b.tie);
  const sums=teams.map(()=>[0,0,0,0]),assignments={};
  for(let start=0;start<sorted.length;start+=teams.length){
   const order=teams.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=randomIndex(i+1);[order[i],order[j]]=[order[j],order[i]];}
   order.forEach((team,i)=>{const p=sorted[start+i];assignments[p.id]=teams[team];p.ratings.forEach((score,d)=>sums[team][d]+=score);});
  }
  let cost=0;for(let d=0;d<4;d++){const mean=sums.reduce((a,s)=>a+s[d],0)/teams.length;cost+=sums.reduce((a,s)=>a+(s[d]-mean)**2,0);}
  if(cost<bestCost){bestCost=cost;best=assignments;}
 }
 validateTeams(players,best);return best;
}
export function validateTeams(players,assignments){
 const people=draftRoster(players),teams=people.length===18?['A','B','C']:['A','B','C','D'];
 if(![18,24].includes(people.length))throw Error('チーム分けは名前登録済みの参加者18人または24人で行います。19〜23人の場合は追加募集または欠員対応を確認してください。');
 if(new Set(people.map(p=>p.authUid)).size!==people.length||people.some(p=>!p.authUid))throw Error('参加者コードの準備・重複を確認してください。');
 for(const p of people)if(!teams.includes(assignments[p.id]))throw Error(`${p.name}のチームを選択してください。`);
 for(const team of teams)if(people.filter(p=>assignments[p.id]===team).length!==6)throw Error(`${team}チームを6人にしてください。`);
 return {people,teams};
}
export async function commitTeamDraft(api,db,players,assignments,{publish=false}={}){
 const {people,teams}=validateTeams(players,assignments);
 for(const p of people)confirmedRatings(p);
 const expected=players.map(p=>[p.id,teamFingerprint(p)]);
 await api.runTransaction(db,async tx=>{
  const snapshots=await Promise.all(expected.map(([id])=>tx.get(api.doc(db,'participants',id))));
  for(let i=0;i<expected.length;i++)if(!snapshots[i].exists()||teamFingerprint({...snapshots[i].data(),id:expected[i][0]})!==expected[i][1])throw Error('名簿または下書きが更新されました。最新の内容を読み直してから作成してください。');
  if(publish){
   if(people.some(p=>p.teamDraft?.evaluationKey!==stableStringify(p.teamEvaluation)||p.teamDraft?.teamId!==assignments[p.id]))throw Error('評価の変更後はチーム案を作り直し、下書きを保存してから公開してください。');
   if(people.some(p=>p.divisions?.length))throw Error('部門決定後はこの画面からチームを変更できません。');
   const pairs=['AB','CD','AC','BD','AD','BC'];
   const rooms=await Promise.all(divisions.flatMap(d=>pairs.map((pair,i)=>tx.get(api.doc(db,'rooms',`${d.id}-r${Math.floor(i/2)+1}-${pair}`)))));
   if(rooms.some(s=>s.exists()))throw Error('本番の対戦カード作成後はチーム公開・再編成できません。');
   const stage=await tx.get(api.doc(db,'competition','state'));
   if(stage.data()?.divisionsPublished)throw Error('部門発表後はチームを組み直せません。');
  }
  for(const p of people)tx.update(api.doc(db,'participants',p.id),{
   teamDraft:{teamId:assignments[p.id],evaluationKey:stableStringify(p.teamEvaluation)},teamDraftUpdatedAt:api.serverTimestamp(),
   ...(publish?{teamId:assignments[p.id],assignmentStatus:'team-assigned'}:{})
  });
  if(publish)tx.set(api.doc(db,'public','teams'),{
   ...teamPublicData(people.map(p=>({...p,teamId:assignments[p.id]})),teams),
   summary:teams.map(t=>`${t}チーム\n${people.filter(p=>assignments[p.id]===t).map(p=>p.name).join('・')}`).join('\n\n'),
   updatedAt:api.serverTimestamp()
  });
  if(publish){
   tx.set(api.doc(db,'competition','state'),{teamsPublished:true,teamIds:teams,divisionsPublished:false,updatedAt:api.serverTimestamp()});
   tx.set(api.doc(db,'public','config'),{teamIds:teams,divisionsPublished:false,updatedAt:api.serverTimestamp()});
   for(const p of people)tx.set(api.doc(db,'participantAccess',p.authUid),{participantId:p.id,name:p.name,active:true});
  }
 });
}
