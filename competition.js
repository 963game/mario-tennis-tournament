import {divisions,defaultTeams} from './tournament.js';
import {validScore} from './policy.js';
import {stableStringify} from './data-utils.js';
export const statusNames={unreported:'未報告',pending:'確認待ち',needs_fix:'訂正依頼中',confirmed:'確定'};
export function pairRounds(teams){
 if(teams.join('')==='ABC')return [[['A','B']],[['A','C']],[['B','C']]];
 if(teams.join('')==='ABCD')return [[['A','B'],['C','D']],[['A','C'],['B','D']],[['A','D'],['B','C']]];
 throw Error('チーム構成が不正です。');
}
export function publishedMatch(room){
 return {divisionId:room.divisionId,round:room.round,teamA:room.teamA,teamB:room.teamB,
  teamANames:[...(room.teamANames||[])],teamBNames:[...(room.teamBNames||[])],status:room.status,
  scoreA:room.status==='confirmed'?room.scoreA:null,scoreB:room.status==='confirmed'?room.scoreB:null};
}
export function standings(matches,teams){
 const rows=teams.map(teamId=>({teamId,wins:0,losses:0,played:0,gamesFor:0,gamesAgainst:0,difference:0,rank:0})),map=new Map(rows.map(r=>[r.teamId,r]));
 for(const m of matches){
  if(m.status!=='confirmed')continue;
  const a=map.get(m.teamA),b=map.get(m.teamB);if(!a||!b||a===b||!validScore(m.scoreA,m.scoreB))continue;
  a.played++;b.played++;a.gamesFor+=m.scoreA;a.gamesAgainst+=m.scoreB;b.gamesFor+=m.scoreB;b.gamesAgainst+=m.scoreA;
  if(m.scoreA>m.scoreB){a.wins++;b.losses++;}else{b.wins++;a.losses++;}
 }
 rows.forEach(r=>r.difference=r.gamesFor-r.gamesAgainst);rows.sort((a,b)=>b.wins-a.wins||b.difference-a.difference||a.teamId.localeCompare(b.teamId));
 rows.forEach((r,i)=>r.rank=i&&r.wins===rows[i-1].wins&&r.difference===rows[i-1].difference?rows[i-1].rank:i+1);return rows;
}
export const rosterKey=players=>JSON.stringify(players.filter(p=>p.active&&p.name).map(p=>[p.id,p.name,p.authUid,p.teamId]).sort((a,b)=>a[0].localeCompare(b[0])));
function shuffle(items){const out=[...items];for(let i=out.length-1;i>0;i--){const range=i+1,limit=Math.floor(4294967296/range)*range;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);const j=n%range;[out[i],out[j]]=[out[j],out[i]];}return out;}
export function drawDepartments(players,teams){
 const slots={};
 for(const team of teams){const members=shuffle(players.filter(p=>p.active&&p.name&&p.teamId===team));
  if(members.length!==6)throw Error(`${team}チームが6人ではありません。欠員の場合は部門枠を手動で作成し、代理出場者を選んでください。`);
  let index=0;slots[team]=Object.fromEntries(divisions.map(d=>[d.id,members.slice(index,(index+=d.size)).map(p=>p.id)]));
 }return slots;
}
export function blankSlots(teams){return Object.fromEntries(teams.map(t=>[t,Object.fromEntries(divisions.map(d=>[d.id,Array(d.size).fill('')]))]));}
export function planDepartmentRooms(players,teams,slots){
 const active=players.filter(p=>p.active&&p.name),map=new Map(active.map(p=>[p.id,p]));
 for(const team of teams)for(const d of divisions){const ids=slots?.[team]?.[d.id];
  if(!Array.isArray(ids)||ids.length!==d.size||new Set(ids).size!==d.size)throw Error(`${team}・${d.name}の人数や重複を確認してください。`);
  for(const id of ids){const p=map.get(id);if(!p||p.teamId!==team||!p.authUid)throw Error(`${team}・${d.name}は同じチームの有効な参加者を選んでください。`);}
 }
 const rooms=divisions.flatMap(d=>pairRounds(teams).flatMap((pairs,round)=>pairs.map(([teamA,teamB])=>{
  const a=slots[teamA][d.id].map(id=>map.get(id)),b=slots[teamB][d.id].map(id=>map.get(id));
  if(new Set([...a,...b].map(p=>p.authUid)).size!==a.length+b.length)throw Error('同じ認証アカウントが重複しています。');
  return {id:`${d.id}-r${round+1}-${teamA}${teamB}`,divisionId:d.id,round:round+1,title:`${d.name}・第${round+1}ラウンド`,teamA,teamB,
   teamAUids:a.map(p=>p.authUid),teamBUids:b.map(p=>p.authUid),memberUids:[...a,...b].map(p=>p.authUid),teamANames:a.map(p=>p.name),teamBNames:b.map(p=>p.name),
   status:'unreported',scoreA:0,scoreB:0,reportedBy:'',approvedBy:'',publicReady:true};
 })));
 return rooms;
}
export function teamPublicData(players,teams,slots=null){return {teams:teams.map(teamId=>({teamId,members:players.filter(p=>p.active&&p.name&&p.teamId===teamId).map(p=>({name:p.name,divisions:slots?divisions.filter(d=>slots[teamId]?.[d.id]?.includes(p.id)).map(d=>d.id):[]}))})),divisionsPublished:!!slots};}
export function csvText(headers,rows){const cell=x=>{let text=String(x??'');if(typeof x!=='number'&&(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');}
export function downloadCsv(name,headers,rows){const blob=new Blob([csvText(headers,rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function saveDepartmentDraft(api,db,players,state,slots,{proxy=false}={}){
 if(!state?.teamsPublished)throw Error('先にチーム名簿を公開してください。');if(state.divisionsPublished&&!proxy)throw Error('部門公開後は抽選し直せません。代理変更を使用してください。');
 planDepartmentRooms(players,state.teamIds,slots);
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'competition','state'),snap=await tx.get(ref);if(stableStringify(snap.data())!==stableStringify(state))throw Error('大会状態が更新されました。読み直してください。');
  const current=await Promise.all(players.map(p=>tx.get(api.doc(db,'participants',p.id))));
  if(current.some(s=>!s.exists())||rosterKey(current.map((s,i)=>({...s.data(),id:players[i].id})))!==rosterKey(players))throw Error('参加者・チームが変更されました。');
  tx.set(ref,{...state,departmentDraft:{slots,source:rosterKey(players)},updatedAt:api.serverTimestamp()});
 });
}
export async function publishDepartments(api,db,players,state,{proxy=false}={}){
 if(!state?.teamsPublished||!state.departmentDraft)throw Error('部門の下書きを先に保存してください。');
 if(state.departmentDraft.source!==rosterKey(players))throw Error('名簿が更新されています。部門の下書きを確認して保存し直してください。');
 if(state.divisionsPublished&&!proxy)throw Error('部門は公開済みです。代理変更を使用してください。');
 const planned=planDepartmentRooms(players,state.teamIds,state.departmentDraft.slots);
 await api.runTransaction(db,async tx=>{
  const stateRef=api.doc(db,'competition','state'),fresh=await tx.get(stateRef);
  if(stableStringify(fresh.data())!==stableStringify(state))throw Error('部門の状態が更新されました。');
  const people=await Promise.all(players.map(p=>tx.get(api.doc(db,'participants',p.id))));
  if(rosterKey(people.map((s,i)=>({...s.data(),id:players[i].id})))!==rosterKey(players))throw Error('名簿が更新されました。');
  const old=await Promise.all(planned.map(p=>tx.get(api.doc(db,'rooms',p.id))));
  for(let i=0;i<planned.length;i++){
   const {id,...next}=planned[i],before=old[i].data();
   if(before&&!proxy)throw Error('対戦カードが既に存在します。');
   if(before?.status==='confirmed')continue;
   const changed=before&&JSON.stringify(before.memberUids)!==JSON.stringify(next.memberUids);
   if(before?.status==='pending'&&changed)throw Error('確認待ちの試合があります。先に承認または訂正依頼を行ってください。');
   const room=before?{...before,teamAUids:next.teamAUids,teamBUids:next.teamBUids,memberUids:next.memberUids,teamANames:next.teamANames,teamBNames:next.teamBNames,publicReady:true}:next;
   tx.set(api.doc(db,'rooms',id),{...room,updatedAt:api.serverTimestamp()});
   tx.set(api.doc(db,'publicMatches',id),{...publishedMatch(room),updatedAt:api.serverTimestamp()});
  }
  for(const p of players){if(!p.active||!p.name)continue;const assigned=divisions.filter(d=>state.departmentDraft.slots[p.teamId]?.[d.id]?.includes(p.id)).map(d=>d.id);
   tx.update(api.doc(db,'participants',p.id),{divisions:assigned,assignmentStatus:'division-assigned'});
   tx.set(api.doc(db,'participantAccess',p.authUid),{participantId:p.id,name:p.name,active:true});
  }
  tx.set(api.doc(db,'public','teams'),teamPublicData(players,state.teamIds,state.departmentDraft.slots));
  tx.set(api.doc(db,'public','config'),{teamIds:state.teamIds,divisionsPublished:true,updatedAt:api.serverTimestamp()});
  tx.set(stateRef,{...state,divisionsPublished:true,publishedSlots:state.departmentDraft.slots,updatedAt:api.serverTimestamp()});
 });
}
