// Match the pinned Python reranker's longest-first 384-token pair encoding.
export function encodePair(tokenizer,query,document,maxLength=384){
 const a=tokenizer.encode(query,{add_special_tokens:false}).ids;
 const b=tokenizer.encode(document,{add_special_tokens:false}).ids;
 const available=maxLength-3;
 if(a.length+b.length>available){
  // Rust tokenizers balances lengths in original length order. The originally
  // longer sequence receives the odd token; equal original lengths favour B.
  if(a.length>b.length){const keepB=Math.min(b.length,Math.floor(available/2));a.splice(available-keepB);b.splice(keepB);}
  else{const keepA=Math.min(a.length,Math.floor(available/2));a.splice(keepA);b.splice(available-keepA);}
 }
 return {input_ids:[101,...a,102,...b,102],attention_mask:Array(a.length+b.length+3).fill(1),token_type_ids:[...Array(a.length+2).fill(0),...Array(b.length+1).fill(1)]};
}
