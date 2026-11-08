import {draftRoster,commitTeamDraft,suggestTeams,questionnaireRatings,confirmedRatings,saveEvaluations} from './team-draft.js';
import {divisions} from './tournament.js';
import {stableStringify} from './data-utils.js';
export function mountTeamDraft({api,db,getPlayers,getDraftCount,runAction,say}){
 const root=document.getElementById('teamDraftRows'),notice=document.getElementById('teamDraftNotice');
 let local=null,baseline=null,reviewLocal=null,reviewBaseline=null,reviewPage=0;
 const reviewRoot=document.getElementById('evaluationRows');
 const labels=['未経験（0）','×（1）','▲（2）','○（3）','◎（4）'];
 function reviewValues(){return Object.fromEntries(draftRoster(getPlayers()).map(p=>{
  const ratings=questionnaireRatings(p,{allowUnknown:true});
  return [p.id,p.teamEvaluation?{ratings:[...p.teamEvaluation.ratings],note:p.teamEvaluation.note||''}:{ratings,note:''}];
 }));}
 function renderReviews(){
  reviewRoot.replaceChildren();const all=draftRoster(getPlayers()),query=document.getElementById('evaluationSearch').value.trim().toLowerCase();
  const people=all.filter(p=>`${p.id} ${p.name}`.toLowerCase().includes(query)),pages=Math.max(1,Math.ceil(people.length/6));reviewPage=Math.min(reviewPage,pages-1);
  const values=reviewLocal||reviewValues();
  const checked=all.filter(p=>{try{confirmedRatings(p);return true;}catch{return false;}}).length;
  document.getElementById('evaluationStatus').textContent=`保存済み確認：${checked} / ${all.length}人 ／ ${reviewPage+1} / ${pages}ページ${reviewLocal?' ／ 未保存の評価修正あり':''}`;
  document.getElementById('evaluationPrev').disabled=reviewPage===0;document.getElementById('evaluationNext').disabled=reviewPage>=pages-1;
  for(const p of people.slice(reviewPage*6,reviewPage*6+6)){
   const row=document.createElement('article'),title=document.createElement('strong');title.textContent=`${p.id}　${p.name}`;row.append(title);
   const source=document.createElement('details'),summary=document.createElement('summary');summary.textContent='元の応募回答・実績メモを見る';source.append(summary);
   for(const f of p.application?.fields||[]){const line=document.createElement('p');line.textContent=`${f.header}：${f.value}`;source.append(line);}
   for(const [key,value] of Object.entries(p.assessment||{})){if(!value)continue;const line=document.createElement('p');line.textContent=`${divisions.find(d=>d.id===key)?.name||'全体メモ'}：${value}`;source.append(line);}row.append(source);
   const original=questionnaireRatings(p,{allowUnknown:true});
   const remember=()=>{if(!reviewLocal){reviewLocal=structuredClone(values);reviewBaseline=structuredClone(getPlayers());}return reviewLocal[p.id];};
   divisions.forEach((d,index)=>{
    const label=document.createElement('label');label.textContent=`${d.name}（申告：${original[index]===null?'要確認':labels[original[index]]}）`;const select=document.createElement('select');select.setAttribute('aria-label',`${p.name}の${d.name}の運営評価`);
    const empty=document.createElement('option');empty.value='';empty.textContent='要確認';select.append(empty);
    labels.forEach((text,value)=>{const opt=document.createElement('option');opt.value=value;opt.textContent=text;select.append(opt);});
    select.value=values[p.id]?.ratings[index]??'';select.onchange=()=>{remember().ratings[index]=select.value===''?null:Number(select.value);document.getElementById('evaluationStatus').textContent='未保存の評価修正があります。全員の評価を確認して保存してください。';};label.append(select);row.append(label);
   });
   const note=document.createElement('input');note.maxLength=1000;note.placeholder='修正理由・確認メモ（任意）';note.setAttribute('aria-label',`${p.name}の評価確認メモ`);note.value=values[p.id]?.note||'';note.oninput=()=>{remember().note=note.value;};row.append(note);reviewRoot.append(row);
  }
 }
 function render(){
  renderReviews();
  root.replaceChildren();const people=draftRoster(getPlayers());
  notice.textContent=`名前登録済みの参加者：${people.length}人。${local?'画面に未保存のチーム案があります。':'保存した下書きは画面を閉じても残ります。'}`;
  if(!people.length){root.textContent='本番の応募回答を取り込んだ後に使用します。';return;}
  const teams=people.length===18?['A','B','C']:['A','B','C','D'];
  const assignments=local||Object.fromEntries(people.map(p=>[p.id,p.teamDraft?.teamId||'']));
  const counts=document.createElement('p');counts.textContent=teams.map(t=>`${t}：${people.filter(p=>assignments[p.id]===t).length} / 6人`).join('　');root.append(counts);
  for(const p of people){
   const label=document.createElement('label');label.style.display='block';label.textContent=`${p.id}　${p.name}　`;
   const select=document.createElement('select');select.setAttribute('aria-label',`${p.name}の下書きチーム`);
   for(const team of ['',...teams]){const option=document.createElement('option');option.value=team;option.textContent=team?`${team}チーム`:'未選択';select.append(option);}
   select.value=assignments[p.id]||'';
   select.onchange=()=>{if(!local){local={...assignments};baseline=structuredClone(getPlayers());}local[p.id]=select.value;render();};
   label.append(select);root.append(label);
  }
 }
 async function save(button,publish){
  if(reviewLocal)throw Error('修正した運営評価を先に保存してください。');
  if(getDraftCount())throw Error('名簿の未保存の入力を先に保存してください。');
  const source=baseline||structuredClone(getPlayers()),people=draftRoster(source);
  const assignments=local||Object.fromEntries(people.map(p=>[p.id,p.teamDraft?.teamId||'']));
  if(!confirm(publish?'このチーム案の登録名と所属を一般公開しますか？ 部門はまだ決めません。':'運営専用のチーム案を保存しますか？ 参加者には公開しません。'))return;
  await commitTeamDraft(api,db,source,assignments,{publish});
  for(const p of getPlayers())if(Object.hasOwn(assignments,p.id))p.teamDraft={teamId:assignments[p.id],evaluationKey:stableStringify(p.teamEvaluation)};
  local=null;baseline=null;render();say(publish?'チーム名簿を公開しました。部門は未決定です。':'チーム案を運営専用の下書きとして保存しました。');
 }
 document.getElementById('saveTeamDraft').onclick=e=>runAction(e.currentTarget,()=>save(null,false));
 document.getElementById('publishTeamDraft').onclick=e=>runAction(e.currentTarget,()=>save(null,true));
 document.getElementById('reloadTeamDraft').onclick=()=>{if(local&&!confirm('画面の未保存のチーム案を破棄し、保存済みの下書きへ戻しますか？'))return;local=null;baseline=null;render();};
 document.getElementById('suggestTeamDraft').onclick=e=>runAction(e.currentTarget,async()=>{
  if(reviewLocal)throw Error('修正した運営評価を先に保存してください。');
  if(getDraftCount())throw Error('名簿の未保存の入力を先に保存してください。');
  if(!confirm('運営が確認・保存した４部門の評価でチーム案を作ります。画面のチーム案を置き換えてよいですか？ 保存・公開は別です。'))return;
  const source=structuredClone(getPlayers()),next=suggestTeams(source);baseline=source;local=next;render();say('チーム案を作成しました。実力の確定評価ではありません。確認・変更してから下書きを保存してください。');
 });
 document.getElementById('evaluationSearch').oninput=()=>{reviewPage=0;renderReviews();};
 document.getElementById('evaluationPrev').onclick=()=>{reviewPage--;renderReviews();};
 document.getElementById('evaluationNext').onclick=()=>{reviewPage++;renderReviews();};
 document.getElementById('saveEvaluations').onclick=e=>runAction(e.currentTarget,async()=>{
  if(getDraftCount())throw Error('名簿の未保存の入力を先に保存してください。');
  if(!confirm('全員の４部門の運営評価を確認済みとして保存しますか？ 元の回答は残します。チーム案は保存後に作成してください。'))return;
  const source=reviewBaseline||structuredClone(getPlayers()),values=reviewLocal||reviewValues();
  const saved=await saveEvaluations(api,db,source,values);
  for(const p of getPlayers())if(saved[p.id])p.teamEvaluation=saved[p.id];
  reviewLocal=null;reviewBaseline=null;local=null;baseline=null;render();say('運営の評価を保存しました。この評価でチーム案を作成してください。');
 });
 return {render,clear(){local=null;baseline=null;reviewLocal=null;reviewBaseline=null;reviewPage=0;root.replaceChildren();reviewRoot.replaceChildren();notice.textContent='';document.getElementById('evaluationStatus').textContent='';}};
}
