import {divisions} from './tournament.js';
import {allCourts,prepareRoundPlan,startNextRound} from './round-control.js';
export function mountRoundControl({api,db,getState,getRooms,runAction,say}){
 let editedCourts=null;
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 function render(){
  const state=getState(),control=state.roundControl,root=el('section');root.dataset.area='departments';root.id='roundControl';root.append(el('h2','ラウンド進行・コート・部屋立て'));
  root.append(el('p','各ラウンドの２試合は同じコートです。左側のチームが部屋立て担当。次の開始は、現在の全試合が確定してから行います。'));
  const label=el('label','抽選対象のコート：全18種類'),input=el('textarea');input.rows=5;input.style.cssText='display:block;width:95%;font:inherit';input.value=allCourts.join('\n');input.readOnly=true;input.setAttribute('aria-label','抽選対象コート');input.disabled=(control?.index??-1)>=0;input.oninput=()=>editedCourts=input.value;label.append(input);root.append(label);
  const prepare=el('button',control?'開始前のコート・部屋立てを抽選し直す':'コート・部屋立てを抽選して保存（非公開）');prepare.disabled=!state.divisionsPublished||(control?.index??-1)>=0;
  prepare.onclick=()=>runAction(prepare,async()=>{const courts=[...allCourts];if(!confirm('全12ラウンドのコートと部屋立てを抽選・保存しますか？ 参加者への公開は各ラウンド開始時です。'))return;await prepareRoundPlan(api,db,state,courts);editedCourts=null;say('進行用の抽選を保存しました。「次のラウンドを開始」で公開してください。');});root.append(prepare);
  if(control){
   const group=control.plan[control.index],next=control.plan[control.index+1],rooms=getRooms();
   const complete=group&&group.matchIds.every(id=>rooms.find(r=>r.id===id)?.status==='confirmed');
   root.append(el('p',group?`現在：${divisions.find(d=>d.id===group.divisionId)?.name} 第${group.round}ラウンド ／ ${complete?'全結果確定':'進行中'} ／ コート：${group.courtName}`:'大会の開始前です。最初のラウンドを開始してください。'));
   if(next){const start=el('button',`次のラウンドを開始：${divisions.find(d=>d.id===next.divisionId)?.name} 第${next.round}`);start.disabled=!!group&&!complete;start.onclick=()=>runAction(start,async()=>{if(!confirm('次のラウンドを開始し、そのコート・部屋立て担当を公開しますか？'))return;await startNextRound(api,db,state);say('ラウンドを開始しました。参加者のカードと進捗に反映されます。');});root.append(start);}else root.append(el('p',complete?'大会の全ラウンドが終了しました。':'最終ラウンドの結果確定を待っています。'));
   const details=el('details');details.append(el('summary','運営専用：全ラウンドの抽選内容を確認'));
   for(const g of control.plan){details.append(el('p',`${divisions.find(d=>d.id===g.divisionId)?.name} 第${g.round}ラウンド：${g.courtName} ／ 部屋立て：${Object.values(g.hosts).join('・')}`));}root.append(details);
  }return root;
 }
 return {render,clear(){editedCourts=null;}};
}
