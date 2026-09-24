import PDFDocument from 'pdfkit';
import {parseFragment} from 'parse5';
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const doc=new PDFDocument({size:'A4',margin:50,bufferPages:true,info:{Title:'Website discovery plan',Author:'AI Crawler Checker'}});
doc.registerFont('Regular',require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
doc.registerFont('Bold',require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'));
const chunks=[];let bytes=0;
doc.on('data',chunk=>{bytes+=chunk.length;if(bytes>2000000)throw new Error('PDF size exceeded');chunks.push(chunk);});
doc.on('end',()=>parentPort.postMessage(Buffer.concat(chunks)));
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(c=>c.tagName==='br'?'\n':text(c)).join('');
const bottom=doc.page.height-65;
function block(value,{size=10,bold=false,color='#233b30',gap=8,heading=false}={}){
 value=value.length>4000?value.slice(0,4000)+' [Evidence shortened; review the full audit.]':value;
 doc.font(bold?'Bold':'Regular').fontSize(size).fillColor(color);
 // Unsupported glyphs remain inspectable rather than silently disappearing.
 value=[...value].map(c=>c==='\n'||doc._font.font.hasGlyphForCodePoint(c.codePointAt(0))?c:'[U+'+c.codePointAt(0).toString(16).toUpperCase()+']').join('');
 const height=doc.heightOfString(value,{width:495,lineGap:3});
 if(doc.y+(heading?height+60:Math.min(height,100))>bottom)doc.addPage();
 doc.text(value,{width:495,lineGap:3});
 doc.y+=gap;
}
function walk(node){
 if(node.tagName==='dl'){
  const children=(node.childNodes||[]).filter(n=>n.tagName);
  for(let i=0;i<children.length;i+=2)block(text(children[i])+': '+text(children[i+1]),{gap:5});
  doc.moveDown(.4);return;
 }
 if(['h1','h2','h3','p'].includes(node.tagName)){
  const level=node.tagName;
  block(text(node),{size:level==='h1'?26:level==='h2'?16:level==='h3'?12:10,bold:level!=='p',heading:level!=='p',color:level==='h1'||level==='h2'?'#216744':'#233b30',gap:level==='h2'?12:8});
  return;
 }
 for(const child of node.childNodes||[])walk(child);
}
walk(parseFragment(workerData));
const range=doc.bufferedPageRange();
for(let i=0;i<range.count;i++){
 doc.switchToPage(i);
 doc.page.margins.bottom=0;
 doc.font('Regular').fontSize(8).fillColor('#617268').text('AI Crawler Checker  |  '+(i+1)+' / '+range.count,50,doc.page.height-38,{width:495,lineBreak:false,align:'right'});
}
doc.end();
