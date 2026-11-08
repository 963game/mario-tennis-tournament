import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,onAuthStateChanged,signInAnonymously} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,onSnapshot,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';

// Separate identity: entering/leaving a match must not discard the check-in receipt.
const app=initializeApp(firebaseConfig,'checkin-receipt');
const auth=getAuth(app),db=getFirestore(app),$=id=>document.getElementById(id);
let stops=[],latestDelivery=null,currentUid='',ready=false,hasRequest=false;
const say=text=>$('checkinMessage').textContent=text;
function fail(){say('受付情報を取得できません。通信を確認し、直らない場合は運営にお知らせください。');}
function seenKey(){return 'receipt-seen-'+currentUid;}
function version(d){return `${d?.updatedAt?.seconds||0}:${d?.updatedAt?.nanoseconds||0}`;}
function getSeen(){try{return localStorage.getItem(seenKey());}catch{return '';}}
function markSeen(){try{localStorage.setItem(seenKey(),version(latestDelivery));}catch{}$('receiptBadge').textContent='';}
$('receiptButton').onclick=()=>{
  $('receiptDetail').hidden=!$('receiptDetail').hidden;
  if(!$('receiptDetail').hidden && latestDelivery)markSeen();
};
$('checkinSubmit').disabled=true;
$('copyDeliveredCode').onclick=async()=>{
  if(!latestDelivery)return;
  try{await navigator.clipboard.writeText(latestDelivery.code);say('コードをコピーしました。「対戦カード」の入力欄に貼り付けてください。');}
  catch{say('自動コピーできませんでした。表示されたコードを選択してコピーしてください。');}
};
try{
  await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,user=>{
    ready=true;$('checkinSubmit').disabled=false;stops.forEach(stop=>stop());stops=[];
    latestDelivery=null;hasRequest=false;currentUid=user?.uid||'';$('deliveredCode').textContent='';$('copyDeliveredCode').hidden=true;
    if(!user){say('参加登録した名前でチェックインを申請してください。');return;}
    stops.push(onSnapshot(doc(db,'checkins',user.uid),snap=>{
      const d=snap.data();hasRequest=!!d;$('checkinSubmit').disabled=hasRequest;
      if(!d){$('receiptButton').firstChild.textContent='🔔 お知らせ ';say('参加登録した名前でチェックインを申請してください。');return;}
      $('checkinName').value=d.name;
      say(d.status==='pending'?'チェックインを申請しました。あとでこのサイトから確認できます。':d.status==='approved'?'チェックインが承認されました。通知からコードを確認してください。':'申請は承認されませんでした。名前を確認し、運営にお問い合わせください。');
      $('receiptButton').firstChild.textContent=d.status==='pending'?'🔔 確認待ち ':d.status==='approved'?'🔔 コードが届いています ':'🔔 運営からのお知らせ ';
    },fail));
    stops.push(onSnapshot(doc(db,'deliveries',user.uid),snap=>{
      latestDelivery=snap.data()||null;
      $('copyDeliveredCode').hidden=!latestDelivery;
      $('deliveredCode').textContent=latestDelivery?.code||'';
      $('deliveryName').textContent=latestDelivery?`${latestDelivery.name}さんの入室コード`:'';
      $('receiptBadge').textContent=latestDelivery && getSeen()!==version(latestDelivery)?'●':'';
      if(latestDelivery && !$('receiptDetail').hidden)markSeen();
    },fail));
  });
}catch{say('このブラウザーでは受付情報を保存できません。通常モードで開き直してください。');}
$('checkinSubmit').onclick=async()=>{
  if(!ready)return;
  const name=$('checkinName').value.trim();
  if(!name || name.length>60){say('登録した名前を1〜60文字で入力してください。');return;}
  if(!confirm(`${name}さんとしてチェックインしますか？`))return;
  $('checkinSubmit').disabled=true;
  try{
    const settings=await getDoc(doc(db,'settings','checkin'));
    if(!settings.data()?.accepting){say('現在、チェックインの受付は開始していません。');return;}
    const user=auth.currentUser||(await signInAnonymously(auth)).user;
    const ref=doc(db,'checkins',user.uid),existing=await getDoc(ref);
    if(existing.exists()){say('すでに申請済みです。通知をご確認ください。');return;}
    await setDoc(ref,{name,ownerUid:user.uid,status:'pending',createdAt:serverTimestamp()});
    say('チェックインを申請しました。あとでこのサイトから確認できます。');
  }catch{fail();}finally{$('checkinSubmit').disabled=hasRequest;}
};
