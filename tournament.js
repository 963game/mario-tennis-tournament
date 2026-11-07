export const divisions = [
  {id:'classic-single',name:'クラシック・シングルス',size:1},
  {id:'fever-single',name:'フィーバー・シングルス',size:1},
  {id:'classic-double',name:'クラシック・ダブルス',size:2},
  {id:'fever-double',name:'フィーバー・ダブルス',size:2}
];
export const rounds = [[['A','B'],['C','D']],[['A','C'],['B','D']],[['A','D'],['B','C']]];
export const defaultTeams={A:'Aチーム',B:'Bチーム',C:'Cチーム',D:'Dチーム'};
export function normalizedName(value){return String(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
export function publicMatches(rooms){
  return rooms.filter(r=>divisions.some(d=>d.id===r.divisionId)).map(r=>({
    divisionId:r.divisionId,round:r.round,teamA:r.teamA,teamB:r.teamB,
    status:r.status==='confirmed'?'confirmed':'unreported',
    ...(r.status==='confirmed'?{scoreA:r.scoreA,scoreB:r.scoreB}:{})
  }));
}
export function overviewText(data,names){
  if(!Array.isArray(data?.matches))return data?.summary||'公開結果は未登録です';
  return divisions.flatMap(div=>[div.name,...[1,2,3].flatMap(round=>[
    `第${round}ラウンド（2試合同時進行）`,
    ...data.matches.filter(r=>r.divisionId===div.id && r.round===round).map(r=>
      `${names[r.teamA]||r.teamA} vs ${names[r.teamB]||r.teamB}：${r.status==='confirmed'?`${r.scoreA}－${r.scoreB}（確定）`:'結果未確定'}`)
  ])]).join('\n');
}
export function randomPassword(){
  return 'Aa9!'+Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function initialSlot(index){
  return {id:`P${101+index}`,name:'',teamId:'ABCD'[Math.floor(index/6)],divisions:[],active:true,authUid:'',assignedRequestUid:''};
}
export async function prepareParticipants(api,db,authApi,provisionAuth,onProgress=()=>{}){
  for(let i=0;i<24;i++){
    onProgress(i+1);
    const slot=initialSlot(i),ref=api.doc(db,'participants',slot.id);
    // Persist only in an operator-private document, so interrupted work can resume.
    await api.runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists())tx.set(ref,{...slot,password:randomPassword(),createdAt:api.serverTimestamp()});
    });
    const person=(await api.getDoc(ref)).data();if(person.authUid)continue;
    const email=slot.id.toLowerCase()+'@players.invalid';let credential;
    try{
      try{credential=await authApi.createUserWithEmailAndPassword(provisionAuth,email,person.password);}
      catch(e){
        if(e.code!=='auth/email-already-in-use')throw e;
        credential=await authApi.signInWithEmailAndPassword(provisionAuth,email,person.password);
      }
      await api.updateDoc(ref,{authUid:credential.user.uid});
    }finally{await authApi.signOut(provisionAuth);}
  }
}
export function planRooms(players){
  const active=players.filter(p=>p.active);
  if(active.some(p=>!p.name?.trim() || !p.authUid || !Object.hasOwn(defaultTeams,p.teamId)))
    throw Error('有効な参加者全員の名前・チーム・コードを準備してください。');
  if(new Set(active.map(p=>p.authUid)).size!==active.length) throw Error('参加者の重複があります。');
  return divisions.flatMap(division=>rounds.flatMap((pairs,round)=>pairs.map(([teamA,teamB])=>{
    const members=team=>active.filter(p=>p.teamId===team && p.divisions.includes(division.id)).map(p=>p.authUid);
    const teamAUids=members(teamA),teamBUids=members(teamB);
    if(teamAUids.length!==division.size || teamBUids.length!==division.size)
      throw Error(`${division.name}：各チーム${division.size}人の出場者を指定してください。`);
    return {id:`${division.id}-r${round+1}-${teamA}${teamB}`,divisionId:division.id,round:round+1,
      title:`${division.name}・第${round+1}ラウンド`,teamA,teamB,teamAUids,teamBUids,
      memberUids:[...teamAUids,...teamBUids],status:'unreported',scoreA:0,scoreB:0,reportedBy:'',approvedBy:''};
  })));
}
export function createWorkflows(api,db){
  const {doc,runTransaction,serverTimestamp}=api;
  return {
    async approve(requestUid,participantId){
      return runTransaction(db,async tx=>{
        const requestRef=doc(db,'checkins',requestUid),personRef=doc(db,'participants',participantId);
        const [requestSnap,personSnap]=await Promise.all([tx.get(requestRef),tx.get(personRef)]);
        const request=requestSnap.data(),person=personSnap.data();
        if(request?.status!=='pending') throw Error('この申請は確認済みです。');
        if(!person?.active || !person.authUid || !person.password || !person.name) throw Error('参加者の準備が完了していません。');
        if(person.assignedRequestUid) throw Error('この参加者のコードは配布済みです。重複申請を確認してください。');
        tx.update(requestRef,{status:'approved',participantId,updatedAt:serverTimestamp()});
        tx.update(personRef,{assignedRequestUid:requestUid});
        tx.set(doc(db,'deliveries',requestUid),{participantId,name:person.name,code:`${participantId}-${person.password}`,updatedAt:serverTimestamp()});
      });
    },
    async reflectAssignments(planned){
      return runTransaction(db,async tx=>{
        const snapshots=await Promise.all(planned.map(p=>tx.get(doc(db,'rooms',p.id))));
        for(let i=0;i<planned.length;i++){
          const {id,...next}=planned[i],ref=doc(db,'rooms',id),old=snapshots[i].data();
          if(!old){tx.set(ref,{...next,updatedAt:serverTimestamp()});continue;}
          const same=JSON.stringify(old.teamAUids)===JSON.stringify(next.teamAUids) && JSON.stringify(old.teamBUids)===JSON.stringify(next.teamBUids);
          if(old.status==='pending' && !same) throw Error('確認待ちの試合があります。承認または訂正依頼後に代理出場を変更してください。');
          if(['unreported','needs_fix'].includes(old.status))
            tx.update(ref,{teamAUids:next.teamAUids,teamBUids:next.teamBUids,memberUids:next.memberUids,updatedAt:serverTimestamp()});
        }
      });
    }
  };
}
