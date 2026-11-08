import {decodeCsv,parseCsv,suggestNameColumn,planCsvImport,commitCsvImport} from './csv-import.js';

export function mountCsvImport({api,db,getPlayers,getDraftCount,runAction,say}){
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let parsed=null,selections=[],plan=null,fileName='',fileVersion=0;
  function resetPreview(){plan=null;$('csvSave').disabled=true;$('csvPreview').replaceChildren();$('csvProblems').replaceChildren();$('csvSummary').textContent='';}
  function error(message){$('csvProblems').textContent=message;$('csvSave').disabled=true;}
  async function readFile(){
    const version=++fileVersion;resetPreview();parsed=null;$('csvMapping').hidden=true;$('csvFileInfo').textContent='';
    const file=$('csvFile').files[0];if(!file)return;
    try{
      if(file.size>2*1024*1024)throw Error('CSVは2MB以下のファイルを選んでください。');
      const decoded=decodeCsv(await file.arrayBuffer(),$('csvEncoding').value);
      if(version!==fileVersion)return;
      parsed=parseCsv(decoded.text);fileName=file.name;selections=parsed.rows.map(()=>({included:true}));
      $('csvFileInfo').textContent=`${file.name} ／ ${parsed.rows.length}人分のデータ ／ ${decoded.encoding==='utf-8'?'UTF-8':'Shift-JIS'}`;
      const options=parsed.headers.map((h,i)=>`<option value="${i}">${i+1}列目：${esc(h)}</option>`).join('');
      $('csvNameColumn').innerHTML='<option value="-1">登録名の列を選んでください</option>'+options;
      $('csvNameColumn').value=String(suggestNameColumn(parsed.headers));
      $('csvIdentityColumn').innerHTML='<option value="-1">使わない（登録名で照合）</option>'+options;
      $('csvFields').innerHTML=parsed.headers.map((h,i)=>`<label><input type="checkbox" data-column="${i}" checked>${esc(h)}</label>`).join('');
      $('csvMapping').hidden=false;
      $('csvFields').querySelectorAll('input').forEach(input=>input.onchange=resetPreview);
    }catch(e){if(version===fileVersion)error(e.message||'CSVを読み込めません。文字コードやファイル形式をご確認ください。');}
  }
  $('csvFile').onchange=readFile;$('csvEncoding').onchange=readFile;
  $('csvNameColumn').onchange=()=>{selections=parsed?.rows.map(()=>({included:true}))||[];resetPreview();};
  $('csvIdentityColumn').onchange=resetPreview;
  function options(){return {
    nameColumn:Number($('csvNameColumn').value),identityColumn:Number($('csvIdentityColumn').value),sourceFile:fileName,
    selectedColumns:[...$('csvFields').querySelectorAll('input:checked')].map(el=>Number(el.dataset.column)),selections
  };}
  function renderPlan(){
    if(!parsed)return;
    if(getDraftCount()){error('名簿に未保存の入力があります。先に保存してからプレビューしてください。');return;}
    try{plan=planCsvImport(parsed,options(),getPlayers());}
    catch(e){error(e.message);plan=null;return;}
    $('csvProblems').replaceChildren();
    if(plan.errors.length){const p=document.createElement('p');p.textContent='このままでは保存できません。';$('csvProblems').append(p);}
    for(const message of [...plan.errors,...plan.warnings]){
      const p=document.createElement('p');p.textContent=message;$('csvProblems').append(p);
    }
    if(Number($('csvIdentityColumn').value)<0){const p=document.createElement('p');p.textContent='回答IDやメールなど、回答を一意に識別する列があれば指定してください。登録名だけの場合、後で名前が変わると同じ人と判別できないことがあります。';$('csvProblems').append(p);}
    $('csvSummary').textContent=`取込対象：${plan.count||0}人 ／ 新規：${plan.records.filter(r=>r.kind==='新規登録').length}人 ／ 更新：${plan.records.filter(r=>r.kind==='既存の情報更新').length}人 ／ 未使用にする空き枠：${plan.unused.length}枠`;
    const players=getPlayers(),records=new Map(plan.records.map(r=>[r.index,r]));$('csvPreview').replaceChildren();
    const nameColumn=Number($('csvNameColumn').value);
    if(nameColumn<0){$('csvSave').disabled=true;return;}
    parsed.rows.forEach((row,index)=>{
      const record=records.get(index),choice=selections[index],article=document.createElement('article');
      article.innerHTML=`<label><input class="include" type="checkbox" ${choice.included?'checked':''}>データ${row.record}行目を取り込む</label><label>登録名<input class="importName" maxlength="60" value="${esc(choice.name??row.cells[nameColumn])}"></label><label>参加者番号<select class="target"><option value="">自動で照合・空き枠に割り当て</option>${players.map(p=>`<option value="${esc(p.id)}">${esc(p.id+'：'+(p.name||'空き枠'))}</option>`).join('')}</select></label><p class="match"></p><details><summary>保存する回答を確認</summary><dl></dl></details>`;
      article.querySelector('.target').value=choice.targetId||'';
      article.querySelector('.match').textContent=record?`${record.targetId||'割り当て先なし'} ／ ${record.kind}${record.errors.length?' ／ 要確認':''}`:'対象外（変更しません）';
      const list=article.querySelector('dl');
      for(const column of [...new Set([nameColumn,...options().selectedColumns])]){
        const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=parsed.headers[column];dd.textContent=row.cells[column];dd.style.whiteSpace='pre-wrap';list.append(dt,dd);
      }
      article.querySelector('.include').onchange=e=>{choice.included=e.target.checked;renderPlan();};
      article.querySelector('.target').onchange=e=>{choice.targetId=e.target.value;renderPlan();};
      article.querySelector('.importName').onchange=e=>{choice.name=e.target.value;renderPlan();};
      $('csvPreview').append(article);
    });
    $('csvSave').disabled=plan.errors.length>0;
  }
  $('csvPreviewButton').onclick=renderPlan;
  $('csvSave').onclick=()=>runAction($('csvSave'),async()=>{
    if(!plan || plan.errors.length)throw Error('プレビューのエラーを解消してください。');
    if(getDraftCount())throw Error('名簿に未保存の入力があります。先に保存してください。');
    if(!confirm(`${plan.count}人分の名前と選択した回答を、運営専用の名簿に保存しますか？\nUID・個別コード・既存の所属と部門は変更しません。空き枠${plan.unused.length}件は未使用にします。`))return;
    await commitCsvImport(api,db,plan);
    resetPreview();$('csvFile').value='';$('csvMapping').hidden=true;parsed=null;selections=[];
    $('csvFileInfo').textContent='取り込みが完了しました。実力評価・チーム編成・部門抽選はまだ行っていません。';
    say('CSVの名簿取り込みが完了しました。個別コードはそのまま使えます。');
  });
  return {clear(){++fileVersion;parsed=null;plan=null;selections=[];$('csvFile').value='';$('csvMapping').hidden=true;$('csvFileInfo').textContent='';resetPreview();}};
}
