import {divisions} from './tournament.js';
import {cleanAssessment,saveAssessment} from './assessment.js';
export function mountAssessment({api,db,getPlayers,runAction,say}){
 const root=document.getElementById('assessmentRows'),notice=document.getElementById('assessmentNotice'),drafts=new Map();
 const updateNotice=()=>{notice.textContent=drafts.size?`実績メモの未保存：${drafts.size}人分。画面を閉じる前に保存してください。`:'実績メモは運営だけが閲覧できます。未記入は実績不明として扱い、弱いという意味にはしません。';};
 function render(){
  root.replaceChildren();
  const people=getPlayers().filter(p=>p.name?.trim());
  if(!people.length){root.textContent='本番の応募回答を名簿に保存すると参加者が表示されます。テスト回答を保存する必要はありません。';updateNotice();return;}
  for(const p of people){
   const row=document.createElement('details'),summary=document.createElement('summary');
   summary.textContent=`${p.name}（${p.id}）${p.active?'':'・参加対象外'}${drafts.has(p.id)?'・未保存':''}`;row.append(summary);row.open=drafts.has(p.id);
   const list=document.createElement('dl');
   for(const field of p.application?.fields||[]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=field.header;dd.textContent=field.value;dd.style.whiteSpace='pre-wrap';list.append(dt,dd);}
   if(!list.childNodes.length)list.textContent='応募回答は未登録です。';row.append(list);
   const help=document.createElement('p');help.textContent='部門ごとに、確認できた順位・大会名・結果・時期・資料の参照先などを記録できます。画像自体の保存や自動採点は行いません。';row.append(help);
   const value=drafts.get(p.id)?.value||p.assessment||{},inputs={};
   for(const field of [...divisions,{id:'note',name:'全体メモ・確認事項'}]){
    const label=document.createElement('label');label.style.display='block';label.textContent=field.name;
    const input=document.createElement('textarea');input.rows=3;input.maxLength=3000;input.value=value[field.id]||'';input.style.cssText='width:95%;display:block;font:inherit';input.setAttribute('aria-label',`${p.name}：${field.name}の実績メモ`);
    input.oninput=()=>{drafts.set(p.id,{person:drafts.get(p.id)?.person||p,value:Object.fromEntries(Object.entries(inputs).map(([key,el])=>[key,el.value]))});updateNotice();};
    inputs[field.id]=input;label.append(input);row.append(label);
   }
   const save=document.createElement('button');save.textContent='この人の実績メモを保存';
   save.onclick=()=>runAction(save,async()=>{
    const next=cleanAssessment(Object.fromEntries(Object.entries(inputs).map(([key,el])=>[key,el.value])));
    await saveAssessment(api,db,drafts.get(p.id)?.person||p,next);
    p.assessment=next;drafts.delete(p.id);render();say(`${p.name}の実績メモを保存しました。チーム・部門・公開画面は変更していません。`);
   });row.append(save);root.append(row);
  }
  updateNotice();
 }
 return {render,clear(){drafts.clear();root.replaceChildren();notice.textContent='';}};
}
