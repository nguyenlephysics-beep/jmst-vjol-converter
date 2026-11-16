"use strict";
/* Hoàn thiện các UC quản trị, lịch sử, ngoại lệ và vận hành của bản Web 4.0. */
state.techLogs=load("techLogs",[]);
let backupDirectoryHandle=null;

function technicalLog(action,detail={},level="info"){
  if(state.settings.technicalLogs===false)return;
  state.techLogs.push({time:new Date().toISOString(),level,action,detail});
  state.techLogs=state.techLogs.slice(-500);save("techLogs",state.techLogs)
}
function sourceProfile(text,doc){
  const declaration=text.match(/^\s*<\?xml[^>]*encoding=["']([^"']+)["']/i),encoding=(declaration?.[1]||"UTF-8").toUpperCase(),root=doc.documentElement,schema=root.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance","schemaLocation")||"",articles=nodes(root,"article"),hasCurrent=articles.some(a=>a.hasAttribute("current_publication_id")),hasPublication=nodes(root,"publication").length>0;
  return{encoding,schema,version:hasCurrent&&hasPublication?"OJS 3.3":"Không xác định",versionConfirmed:hasCurrent&&hasPublication}
}
const analyzeBeforeCompletion=analyze;
analyze=function(doc){
  const issues=analyzeBeforeCompletion(doc),root=doc.documentElement,articles=nodes(root,"article"),seenArticle=new Map(),seenPublication=new Map(),seenTitle=new Map();
  articles.forEach((article,index)=>{
    if(article.parentNode.localName!=="articles")issues.push({level:"error",message:`Bài ${index+1} nằm sai vị trí`,hint:"Di chuyển article vào trong khối <articles>."});
    const aid=internalId(article)||article.getAttribute("current_publication_id"),ak=aid&&`id:${aid}`;
    if(ak){if(seenArticle.has(ak))issues.push({level:"error",message:`Trùng ID bài ${aid}`,hint:`Trùng với bài thứ ${seenArticle.get(ak)+1}; sửa ID hoặc loại trừ một bản.`});else seenArticle.set(ak,index)}
    children(article,"publication").forEach(pub=>{
      const pid=internalId(pub);if(pid){if(seenPublication.has(pid))issues.push({level:"error",message:`Trùng publication ID ${pid}`,hint:"Mỗi publication phải có ID duy nhất."});else seenPublication.set(pid,index)}
      const title=compact(first(pub,"title")?.textContent).toLocaleLowerCase("vi");if(title){if(seenTitle.has(title))issues.push({level:"warn",message:`Tiêu đề có khả năng trùng: ${compact(first(pub,"title")?.textContent)}`,hint:`Đối chiếu với bài thứ ${seenTitle.get(title)+1}, sau đó sửa hoặc loại trừ.`});else seenTitle.set(title,index)}
    })
  });
  return issues
};

addFiles=async function(files){
  for(const file of files){
    if(!file.name.toLowerCase().endsWith(".xml")){toast(`${file.name}: chỉ chấp nhận XML`);technicalLog("Từ chối tệp",{file:file.name,reason:"Sai định dạng"},"error");continue}
    if(file.size>state.settings.maxFileMb*1048576){toast(`${file.name}: vượt giới hạn ${state.settings.maxFileMb} MB`);technicalLog("Từ chối tệp",{file:file.name,reason:"Vượt dung lượng"},"error");continue}
    try{
      const text=await file.text(),doc=parseXml(text),profile=sourceProfile(text,doc),issues=analyze(doc);
      if(!["UTF-8","UTF8"].includes(profile.encoding))issues.push({level:"error",message:`Mã hóa ${profile.encoding} chưa được hỗ trợ`,hint:"Xuất lại XML với mã hóa UTF-8."});
      if(!profile.versionConfirmed)issues.push({level:"error",message:"Không xác nhận được cấu trúc OJS 3.3",hint:"Tệp phải có publication và current_publication_id theo cấu trúc OJS 3.3."});
      state.files.push({id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,file,doc,sourceInfo:profile,summary:issueSummary(doc,file.name,file.size),issues});technicalLog("Tiếp nhận tệp",{file:file.name,size:file.size,profile,issues:issues.length})
    }catch(e){toast(`${file.name}: ${e.message}`);technicalLog("Lỗi đọc tệp",{file:file.name,error:e.message},"error")}
  }
  renderFiles()
};

function metadataOf(fileItem){
  const container=first(fileItem.doc.documentElement,"articles");
  return children(container,"article").map((article,index)=>{
    const pubs=children(article,"publication"),pub=pubs.find(p=>internalId(p)===article.getAttribute("current_publication_id"))||pubs[0],authors=pub?nodes(pub,"author"):[],authorNames=authors.map(a=>compact([...children(a,"givenname"),...children(a,"familyname")].map(n=>n.textContent).join(" "))).filter(Boolean),affiliations=authors.flatMap(a=>children(a,"affiliation").map(n=>compact(n.textContent))).filter(Boolean),keywords=pub?nodes(pub,"keyword").map(k=>compact(k.textContent)).filter(Boolean):[],doi=pub?children(pub,"id").find(n=>n.getAttribute("type")==="doi")?.textContent:"";
    return{fileId:fileItem.id,index,id:internalId(article)||article.getAttribute("current_publication_id")||String(index+1),title:compact(first(pub,"title")?.textContent)||"(Thiếu tiêu đề)",authors:authorNames.join("; ")||"—",affiliations:affiliations.join("; ")||"—",keywords:keywords.join("; ")||"—",doi:compact(doi)||"—",galleys:pub?nodes(pub,"article_galley").length:0,excluded:article.getAttribute("data-excluded")==="1",profile:fileItem.sourceInfo}
  })
}
renderArticlePreview=function(){
  const rows=state.files.flatMap(metadataOf);
  el("articlePreview").innerHTML=rows.length?`<table class="data-table"><thead><tr><th>Tệp/nguồn</th><th>ID</th><th>Tiêu đề</th><th>Tác giả/Cơ quan</th><th>DOI/Từ khóa</th><th>PDF</th><th>Hiệu chỉnh</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.excluded?"excluded-row":""}"><td>${escapeHtml(state.files.find(f=>f.id===r.fileId)?.file.name||"")}<br><small>${escapeHtml(r.profile?.version||"")} · ${escapeHtml(r.profile?.encoding||"")}</small></td><td>${escapeHtml(r.id)}</td><td class="metadata-cell">${escapeHtml(r.title)}</td><td class="metadata-cell">${escapeHtml(r.authors)}<br><small>${escapeHtml(r.affiliations)}</small></td><td class="metadata-cell">${escapeHtml(r.doi)}<br><small>${escapeHtml(r.keywords)}</small></td><td>${r.galleys}</td><td><button class="link-button" data-edit-full="${r.fileId}|${r.index}">Sửa metadata</button> <button class="link-button" data-toggle-article="${r.fileId}|${r.index}">${r.excluded?"Khôi phục":"Loại trừ"}</button></td></tr>`).join("")}</tbody></table>`:"";
  document.querySelectorAll("[data-edit-full]").forEach(b=>b.onclick=()=>editFullMetadata(b.dataset.editFull));document.querySelectorAll("[data-toggle-article]").forEach(b=>b.onclick=()=>toggleArticle(b.dataset.toggleArticle))
};
function editFullMetadata(token){
  const{item,article}=locateArticle(token);if(!article)return;const pub=children(article,"publication").find(p=>internalId(p)===article.getAttribute("current_publication_id"))||children(article,"publication")[0];if(!pub)return;
  let title=first(pub,"title"),next=prompt("Tiêu đề bài báo:",compact(title?.textContent));if(next===null)return;if(!title){title=create(item.doc,"title",{locale:"vi"});pub.insertBefore(title,pub.firstChild)}title.textContent=next.trim();
  let doi=children(pub,"id").find(n=>n.getAttribute("type")==="doi"),doiValue=prompt("DOI (để trống nếu chưa có):",compact(doi?.textContent));if(doiValue!==null){if(doiValue.trim()){if(!doi){doi=create(item.doc,"id",{type:"doi"});pub.insertBefore(doi,pub.firstChild)}doi.textContent=doiValue.trim()}else doi?.remove()}
  let abstract=first(pub,"abstract"),abstractValue=prompt("Tóm tắt (có thể để trống):",compact(abstract?.textContent));if(abstractValue!==null){if(abstractValue.trim()){if(!abstract){abstract=create(item.doc,"abstract",{locale:"vi"});pub.appendChild(abstract)}abstract.textContent=abstractValue.trim()}else abstract?.remove()}
  item.summary=issueSummary(item.doc,item.file.name,item.file.size);item.issues=analyze(item.doc);technicalLog("Sửa metadata",{file:item.file.name,article:internalId(article)});renderPreview();toast("Đã cập nhật metadata")
}

const conversionBeforeCompletion=convertDocument;
convertDocument=function(source,options){const started=performance.now();try{const result=conversionBeforeCompletion(source,options);technicalLog("Chuyển đổi và kiểm tra đầu ra",{articles:result.stats.articles,warnings:result.warnings.length,durationMs:Math.round(performance.now()-started)});return result}catch(error){technicalLog("Chuyển đổi thất bại",{error:error.message,durationMs:Math.round(performance.now()-started)},"error");throw error}};

enhancedRecordHistory=async function(status){
  const totals=state.results.reduce((a,r)=>{if(r.success){a.files++;a.articles+=r.stats.articles;a.warnings+=r.warnings.length}else a.errors++;return a},{files:0,articles:0,warnings:0,errors:0}),id=Date.now(),details=state.results.map(r=>r.success?{success:true,inputName:r.inputName,outputName:r.outputName,reconciliation:r.reconciliation,statistics:r.stats,warnings:r.warnings}:{success:false,inputName:r.inputName,error:r.error}),entry={id,name:el("projectName").value.trim()||state.files[0]?.file.name||"Dự án chuyển đổi",date:new Date().toISOString(),status,operator:state.settings.operatorName||"Chưa khai báo",config:getOptions(),details,logs:state.techLogs.slice(-100),...totals};
  state.history=state.history.filter(x=>!(x.status==="Đã dừng"&&x.name===entry.name));state.history.unshift(entry);state.history=state.history.slice(0,100);save("history",state.history);
  if(entry.config.retainSource){const sources=[];for(const item of state.files)sources.push({name:item.file.name,type:item.file.type,lastModified:item.file.lastModified,text:new XMLSerializer().serializeToString(item.doc)});await idbSet(String(id),sources)}
  await idbSet(`outputs:${id}`,state.results.filter(r=>r.success).map(r=>({name:r.outputName,xml:r.xml})));technicalLog("Ghi lịch sử",{id,status,operator:entry.operator});renderDashboard()
};
recordHistory=function(status){return enhancedRecordHistory(status)};

table=function(rows){return rows.length?`<table class="data-table"><thead><tr><th>Dự án</th><th>Thời gian</th><th>Người thực hiện</th><th>Trạng thái</th><th>Bài</th><th>Cảnh báo/Lỗi</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${new Date(r.date).toLocaleString("vi-VN")}</td><td>${escapeHtml(r.operator||"Chưa khai báo")}</td><td>${escapeHtml(r.status)}</td><td>${r.articles}</td><td>${r.warnings+r.errors}</td><td><button class="link-button" data-detail-history="${r.id}">Chi tiết/Kết quả</button> <button class="link-button" data-copy-history="${r.id}">Sao chép cấu hình</button> <button class="link-button" data-rerun="${r.id}">Chạy lại</button></td></tr>`).join("")}</tbody></table>`:"<div class='empty-state'>Chưa có lần xử lý nào.</div>"};
const bindActionsBeforeCompletion=bindHistoryActions;
bindHistoryActions=function(){bindActionsBeforeCompletion();document.querySelectorAll("[data-detail-history]").forEach(b=>b.onclick=()=>showHistoryDetail(+b.dataset.detailHistory))};
async function showHistoryDetail(id){
  const h=state.history.find(x=>x.id===id);if(!h)return;const outputs=await idbGet(`outputs:${id}`)||[],results=h.details||[];
  const outputByName=new Map(outputs.map(o=>[o.name,o]));el("detailTitle").textContent=h.name;el("detailContent").innerHTML=`<p><strong>Người thực hiện:</strong> ${escapeHtml(h.operator||"Chưa khai báo")} · <strong>Thời gian:</strong> ${new Date(h.date).toLocaleString("vi-VN")} · <strong>Trạng thái:</strong> ${escapeHtml(h.status)}</p><div class="detail-grid"><div><strong>${h.files}</strong><span>Tệp thành công</span></div><div><strong>${h.articles}</strong><span>Bài báo</span></div><div><strong>${h.warnings}</strong><span>Cảnh báo</span></div><div><strong>${h.errors}</strong><span>Lỗi</span></div></div><h3>Kết quả từng tệp</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Tệp nguồn</th><th>Tệp kết quả</th><th>Trạng thái</th><th>Thông tin</th><th>Tải lại</th></tr></thead><tbody>${results.map(r=>`<tr><td>${escapeHtml(r.inputName)}</td><td>${escapeHtml(r.outputName||"—")}</td><td>${r.success?"Đạt":"Lỗi"}</td><td>${escapeHtml(r.success?(r.warnings||[]).join("; ")||"Không có cảnh báo":r.error)}</td><td>${outputByName.has(r.outputName)?`<button class="link-button" data-output-name="${escapeHtml(r.outputName)}">Tải XML</button>`:"—"}</td></tr>`).join("")}</tbody></table></div><h3>Nhật ký kỹ thuật</h3><div class="log-list">${(h.logs||[]).map(l=>`<div>${escapeHtml(l.time)} [${escapeHtml(l.level)}] ${escapeHtml(l.action)} — ${escapeHtml(JSON.stringify(l.detail))}</div>`).join("")||"Không có nhật ký cho bản ghi cũ."}</div>`;
  document.querySelectorAll("[data-output-name]").forEach(b=>b.onclick=()=>{const o=outputByName.get(b.dataset.outputName);downloadBlob(o.xml,"application/xml;charset=utf-8",o.name)});el("detailModal").classList.remove("hidden")
}
el("closeDetail").onclick=()=>el("detailModal").classList.add("hidden");el("detailModal").onclick=e=>{if(e.target===el("detailModal"))el("detailModal").classList.add("hidden")};

async function rememberFolder(kind){
  if(!window.showDirectoryPicker){toast("Trình duyệt chưa hỗ trợ truy cập thư mục; hãy dùng Chrome hoặc Edge");return null}
  try{const start=kind==="output"?outputDirectoryHandle:backupDirectoryHandle,handle=await window.showDirectoryPicker({mode:"readwrite",startIn:start||undefined,id:`jmst-vjol-${kind}`});if(kind==="output"){outputDirectoryHandle=handle;await idbSet("__outputHandle",handle)}else{backupDirectoryHandle=handle;await idbSet("__backupHandle",handle)}renderFolderStatus();return handle}catch(e){if(e.name!=="AbortError")toast("Không thể truy cập thư mục");return null}
}
function renderFolderStatus(){el("folderStatus").textContent=`Thư mục làm việc: ${outputDirectoryHandle?.name||"Tải xuống mặc định"} · Sao lưu: ${backupDirectoryHandle?.name||"Tải xuống mặc định"}`;if(outputDirectoryHandle)el("chooseOutputFolder").textContent=`Thư mục: ${outputDirectoryHandle.name}`}
el("chooseOutputFolder").onclick=()=>rememberFolder("output");el("settingsOutputFolder").onclick=()=>rememberFolder("output");el("chooseBackupFolder").onclick=()=>rememberFolder("backup");el("openOutputFolder").onclick=async()=>{const h=await rememberFolder("output");if(h)toast(`Đã mở thư mục ${h.name}; các tệp mới sẽ lưu tại đây`)};

async function backupPayload(){const sources=await idbAll();delete sources.__outputHandle;delete sources.__backupHandle;return{version:4,appVersion:APP_VERSION,rules:RULE_VERSION,createdAt:new Date().toISOString(),history:state.history,configs:state.configs,settings:state.settings,technicalLogs:state.techLogs,sources}}
async function writeBackup(download=true){const payload=await backupPayload(),content=JSON.stringify(payload,null,2),name=`jmst-vjol-backup-${new Date().toISOString().slice(0,10)}.json`;if(backupDirectoryHandle){const permission=await backupDirectoryHandle.requestPermission({mode:"readwrite"});if(permission==="granted"){const handle=await backupDirectoryHandle.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(content);await writer.close();toast(`Đã sao lưu vào ${backupDirectoryHandle.name}`);return payload}}if(download)downloadBlob(content,"application/json",name);return payload}
el("backupButton").onclick=()=>writeBackup(true);
el("restoreInput").onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(d.history)state.history=d.history;if(d.configs)state.configs=d.configs;if(d.settings)state.settings=d.settings;if(d.technicalLogs)state.techLogs=d.technicalLogs;for(const[key,value]of Object.entries(d.sources||{}))await idbSet(key,value);save("history",state.history);save("configs",state.configs);save("settings",state.settings);save("techLogs",state.techLogs);loadSettingsUi();renderConfigs();renderDashboard();toast("Đã khôi phục đầy đủ dữ liệu, cấu hình và nhật ký")}catch(error){toast("Tệp sao lưu không hợp lệ")}e.target.value=""};

function loadSettingsUi(){el("operatorName").value=state.settings.operatorName||"";el("defaultBaseUrl").value=state.settings.defaultBaseUrl||el("baseUrl").value;el("defaultOutputName").value=state.settings.defaultOutputName||"{ten-goc}-ojs35.xml";el("maxFileMb").value=state.settings.maxFileMb||100;el("defaultSection").value=state.settings.defaultSection||"Articles";el("technicalLogs").checked=state.settings.technicalLogs!==false}
el("saveSystemSettings").onclick=()=>{state.settings={...state.settings,operatorName:el("operatorName").value.trim(),maxFileMb:Math.max(1,+el("maxFileMb").value||100),defaultSection:el("defaultSection").value.trim()||"Articles",defaultBaseUrl:el("defaultBaseUrl").value.trim(),defaultOutputName:el("defaultOutputName").value.trim()||"{ten-goc}-ojs35.xml",technicalLogs:el("technicalLogs").checked};save("settings",state.settings);el("baseUrl").value=state.settings.defaultBaseUrl;el("outputName").value=state.settings.defaultOutputName;technicalLog("Lưu cấu hình hệ thống",{operator:state.settings.operatorName});toast("Đã lưu và áp dụng cấu hình hệ thống")};

buildReport=function(){return{software:`JMST → VJOL Converter Web ${APP_VERSION}`,rules:RULE_VERSION,project:el("projectName").value||null,operator:state.settings.operatorName||"Chưa khai báo",createdAt:new Date().toISOString(),configuration:getOptions(),technicalLogs:state.techLogs,results:state.results.map(r=>r.success?{input:r.inputName,output:r.outputName,success:true,before:r.inputSummary,after:r.outSummary,statistics:r.stats,reconciliation:r.reconciliation,warnings:r.warnings}:{input:r.inputName,success:false,error:r.error})}};
el("checkUpdate").onclick=async()=>{try{const snapshot=await writeBackup(true);localStorage.setItem(`${KEY}:preUpdateSnapshot`,JSON.stringify(snapshot));technicalLog("Sao lưu trước cập nhật",{version:APP_VERSION});const reg=await navigator.serviceWorker?.getRegistration();await reg?.update();reg?.waiting?.postMessage({type:"SKIP_WAITING"});toast("Đã sao lưu và kiểm tra cập nhật; tải lại trang để áp dụng")}catch(error){toast(`Không thể cập nhật: ${error.message}`)}};
el("rollbackVersion").onclick=()=>{const raw=localStorage.getItem(`${KEY}:preUpdateSnapshot`);if(raw){try{const d=JSON.parse(raw);state.history=d.history||state.history;state.configs=d.configs||state.configs;state.settings=d.settings||state.settings;state.techLogs=d.technicalLogs||state.techLogs;save("history",state.history);save("configs",state.configs);save("settings",state.settings);save("techLogs",state.techLogs)}catch{}}navigator.serviceWorker?.controller?.postMessage({type:"ROLLBACK_CACHE"});toast("Đang khôi phục bản ứng dụng và cấu hình trước cập nhật")};
navigator.serviceWorker?.addEventListener("message",e=>{if(e.data?.type==="ROLLBACK_RESULT")toast(e.data.ok?"Đã chọn phiên bản trước; hãy tải lại trang":"Chưa có phiên bản cũ trong thiết bị này")});

(async()=>{try{outputDirectoryHandle=await idbGet("__outputHandle")||outputDirectoryHandle;backupDirectoryHandle=await idbGet("__backupHandle")}catch{}loadSettingsUi();if(state.settings.defaultBaseUrl)el("baseUrl").value=state.settings.defaultBaseUrl;if(state.settings.defaultOutputName)el("outputName").value=state.settings.defaultOutputName;renderFolderStatus();renderDashboard()})();
