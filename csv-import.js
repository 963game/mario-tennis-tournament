import {normalizedName} from './tournament.js';

export const csvLimits={bytes:2*1024*1024,rows:1000,columns:100,cell:10000,recordBytes:150000};
export function decodeCsv(buffer,encoding='auto'){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.byteLength>csvLimits.bytes)throw Error('CSVは2MB以下のファイルを選んでください。');
  if(!['auto','utf-8','shift_jis'].includes(encoding))throw Error('文字コードの指定を確認してください。');
  if(encoding!=='auto'){
    try{return {text:new TextDecoder(encoding,{fatal:true}).decode(bytes),encoding};}
    catch{throw Error('指定した文字コードでは読み込めません。文字コードを切り替えてください。');}
  }
  try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding:'utf-8'};}
  catch{
    try{return {text:new TextDecoder('shift_jis',{fatal:true}).decode(bytes),encoding:'shift_jis'};}
    catch{throw Error('CSVの文字コードを判別できません。UTF-8のCSVとして保存し直してください。');}
  }
}
export function parseCsv(input){
  const text=String(input).replace(/^\uFEFF/,'');
  if(text.length>csvLimits.bytes*2 || text.includes('\0'))throw Error('CSVの形式または大きさをご確認ください。');
  const records=[];let fields=[],field='',quoted=false,closed=false;
  function pushField(){fields.push(field);field='';closed=false;if(fields.length>csvLimits.columns)throw Error('列は100列まで取り込めます。');}
  function pushRow(){pushField();if(fields.some(v=>v.trim()!==''))records.push(fields);fields=[];
    if(records.length>csvLimits.rows+1)throw Error('CSVは見出しを除き1000行以下にしてください。');}
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c===','){pushField();continue;}
    if(c==='\r' || c==='\n'){pushRow();if(c==='\r' && text[i+1]==='\n')i++;continue;}
    if(closed){if(c===' ' || c==='\t')continue;throw Error('引用符の後に余分な文字があります。CSVを確認してください。');}
    if(c==='"'){if(field!=='')throw Error('CSVの引用符の位置を確認してください。');quoted=true;continue;}
    field+=c;
  }
  if(quoted)throw Error('CSVの引用符が閉じていません。');
  if(field!=='' || fields.length || closed)pushRow();
  if(records.length<2)throw Error('見出し行と、参加者のデータ行が必要です。');
  const headers=records.shift().map(s=>s.trim());
  if(headers.some(s=>!s || s.length>1000))throw Error('1行目の列名に空欄、または長すぎる項目があります。');
  const rows=records.map((cells,index)=>{
    if(cells.length>headers.length)throw Error(`データ${index+1}行目の列数が見出しより多くなっています。`);
    return {record:index+1,cells:[...cells,...Array(headers.length-cells.length).fill('')]};
  });
  return {headers,rows};
}
export function suggestNameColumn(headers){
  const names=['登録名','参加者名','プレイヤー名','ハンドルネーム','お名前','名前','name'];
  return headers.findIndex(h=>names.includes(h.trim().toLowerCase()));
}
export function slotFingerprint(slot){
  return JSON.stringify([slot.id,slot.name||'',slot.active,slot.authUid||'',slot.assignedRequestUid||'',
    slot.teamId,slot.divisions||[],slot.application?.identityKey||'',slot.application?.revision||0]);
}
const isEmptySlot=p=>!p.name?.trim() && !p.assignedRequestUid && !(p.divisions||[]).length;
export function planCsvImport(parsed,options,players){
  const errors=[],warnings=[],records=[],items=[];
  const {nameColumn,identityColumn=-1,sourceFile='',selectedColumns=parsed.headers.map((_,i)=>i),selections=[]}=options;
  if(!Number.isInteger(nameColumn) || nameColumn<0 || nameColumn>=parsed.headers.length)
    return {errors:['登録名に使う列を選んでください。'],warnings,items,records,unused:[]};
  if(identityColumn!==-1 && (!Number.isInteger(identityColumn) || identityColumn<0 || identityColumn>=parsed.headers.length))
    return {errors:['回答の識別に使う列を確認してください。'],warnings,items,records,unused:[]};
  const columns=[...new Set([nameColumn,...selectedColumns])];
  if(columns.some(i=>!Number.isInteger(i) || i<0 || i>=parsed.headers.length))throw Error('保存項目の指定が正しくありません。');
  const roster=[...players].sort((a,b)=>a.id.localeCompare(b.id));
  const rosterMap=new Map(roster.map(p=>[p.id,p]));
  if(rosterMap.size!==roster.length)throw Error('名簿の参加者番号が重複しています。');
  const included=parsed.rows.map((row,index)=>({row,index,choice:selections[index]||{}})).filter(x=>x.choice.included!==false);
  if(included.length===0)errors.push('取り込む参加者を1人以上選んでください。');
  if(included.length>24)errors.push('一度に取り込める参加者は24人までです。対象外の行のチェックを外してください。');
  const usedNames=new Set(),usedIdentities=new Set(),usedSlots=new Set();
  for(const {row,index,choice} of included){
    const originalName=row.cells[nameColumn].trim(),name=(choice.name??originalName).trim();
    const identityKey=identityColumn<0?'':row.cells[identityColumn].trim();
    const record={index,sourceRecord:row.record,name,identityKey,targetId:'',kind:'',errors:[]};records.push(record);
    const problem=message=>{record.errors.push(message);errors.push(`データ${row.record}行目：${message}`);};
    if(!name || name.length>60)problem('登録名を1〜60文字で指定してください。');
    if(name && usedNames.has(normalizedName(name)))problem('登録名が重複しています。プレビューで区別できる登録名に直すか、重複行を対象外にしてください。');
    if(name)usedNames.add(normalizedName(name));
    if(identityColumn>=0 && (!identityKey || identityKey.length>2000))problem('回答の識別値が空欄、または長すぎます。');
    if(identityKey && usedIdentities.has(identityKey))problem('回答の識別値が重複しています。');
    if(identityKey)usedIdentities.add(identityKey);
    let target;
    if(choice.targetId){target=rosterMap.get(choice.targetId);if(!target)problem('指定した参加者番号が名簿にありません。');}
    else{
      let matches=identityKey?roster.filter(p=>p.application?.identityKey===identityKey):[];
      if(!matches.length)matches=roster.filter(p=>p.name && normalizedName(p.name)===normalizedName(originalName));
      if(matches.length>1)problem('既存の名簿に一致する候補が複数あります。割り当て先を確認してください。');
      else if(matches.length===1)target=matches[0];
      else target=roster.find(p=>isEmptySlot(p) && p.authUid && !usedSlots.has(p.id));
    }
    if(!target){if(!record.errors.length)problem('空いている参加者枠がありません。先にコードの準備を確認してください。');continue;}
    record.targetId=target.id;record.kind=isEmptySlot(target)?'新規登録':'既存の情報更新';
    if(usedSlots.has(target.id))problem('同じ参加者番号への二重割り当てがあります。');
    usedSlots.add(target.id);
    if(!target.authUid || !target.password)problem('この枠のアカウント・コードの準備が完了していません。');
    if(!isEmptySlot(target)){
      const sameIdentity=identityKey && target.application?.identityKey===identityKey;
      const sameName=target.name && normalizedName(target.name)===normalizedName(originalName);
      if(!sameIdentity && !sameName)problem('この番号は別の参加者が使用中です。空き枠を選んでください。');
      if(identityKey && target.application?.identityKey && !sameIdentity)problem('以前の回答識別値と異なります。識別列と割り当て先を確認してください。');
      if(target.active===false)warnings.push(`${target.id}は現在不参加です。CSV更新だけでは参加状態を変えません。`);
    }
    const fields=columns.map(column=>({column,header:parsed.headers[column],value:row.cells[column]}));
    if(fields.some(f=>f.value.length>csvLimits.cell))problem('保存項目に1万文字を超える回答があります。保存項目から外すか、CSVを確認してください。');
    if(new TextEncoder().encode(JSON.stringify(fields)).byteLength>csvLimits.recordBytes)problem('この人の保存項目が大きすぎます。保存項目を減らしてください。');
    const patch={name,application:{identityKey,sourceFile:String(sourceFile).slice(0,255),sourceRecord:row.record,
      identityHeader:identityColumn<0?'':parsed.headers[identityColumn],fields,revision:(target.application?.revision||0)+1}};
    if(isEmptySlot(target)){patch.active=true;patch.assignmentStatus='unassigned';}
    items.push({id:target.id,patch});
  }
  for(const p of roster){
    if(usedSlots.has(p.id) || !p.name)continue;
    if(usedNames.has(normalizedName(p.name)))errors.push(`既存の${p.id}と登録名が重複します。回答識別値と登録名をご確認ください。`);
  }
  // Only unused, unnamed, unassigned slots may be disabled. Existing people are never removed.
  const unused=roster.filter(p=>!usedSlots.has(p.id) && isEmptySlot(p) && p.active===true).map(p=>p.id);
  const finalActive=roster.filter(p=>!unused.includes(p.id) && (usedSlots.has(p.id)?(isEmptySlot(p)?true:p.active):p.active));
  if(finalActive.length>24)errors.push('取り込み後の参加者が24人を超えます。名簿を確認してください。');
  if(included.length===18)warnings.push('18人の名簿を保存できます。3チーム編成・12試合の生成は後続の実装で対応します。');
  else if(included.length>=19 && included.length<=23)warnings.push(`${included.length}人分を取り込みます。仕様どおり24人を目指して追加募集できます。`);
  if(roster.some(p=>p.name && !usedSlots.has(p.id)))warnings.push('CSVに含まれない既存参加者の情報・参加状態は、そのまま残します。');
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],records,items,unused,
    expectedRoster:roster.map(p=>({id:p.id,fingerprint:slotFingerprint(p)})),count:included.length};
}
export async function commitCsvImport(api,db,plan){
  if(!plan || plan.errors?.length || !plan.items?.length)throw Error('エラーを解消してから、プレビューを作り直してください。');
  return api.runTransaction(db,async tx=>{
    const snapshots=await Promise.all(plan.expectedRoster.map(p=>tx.get(api.doc(db,'participants',p.id))));
    for(let i=0;i<snapshots.length;i++){
      const snap=snapshots[i],expected=plan.expectedRoster[i];
      if(!snap.exists() || slotFingerprint({...snap.data(),id:expected.id})!==expected.fingerprint)
        throw Error('名簿が更新されています。最新の名簿でプレビューを作り直してください。');
    }
    for(const item of plan.items)tx.update(api.doc(db,'participants',item.id),{...item.patch,importedAt:api.serverTimestamp()});
    for(const id of plan.unused)tx.update(api.doc(db,'participants',id),{active:false});
  });
}
