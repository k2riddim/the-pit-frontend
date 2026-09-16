const inscriptionId=/^[a-f0-9]{64}i\d{1,8}$/;

export function parseInscriptionList(source) {
  let input;
  const text=source.trim();
  if(text.startsWith('[')||text.startsWith('{')){
    const json=JSON.parse(text);input=Array.isArray(json)?json:json.inscriptionIds;
    if(!Array.isArray(input))throw new Error('Use a JSON list of inscription IDs or an inscriptionIds array.');
  }else input=text.split(/[\s,]+/).filter(Boolean);
  if(input.length<1||input.length>20000)throw new Error('A collection list needs 1 to 20,000 inscription IDs.');
  if(input.some(value=>typeof value!=='string'||!inscriptionId.test(value)))throw new Error('One or more inscription IDs are invalid. Use the full lowercase inscription ID, including its i-number.');
  return [...new Set(input)].sort();
}

// Every chunk is below the API body limit. The service stages all chunks and only
// changes the active registry after the final validated chunk; never activate a partial list.
export async function importCollection(collection,post,onProgress=()=>{}) {
  const {inscriptionIds,...details}=collection;
  if(!Array.isArray(inscriptionIds)||!inscriptionIds.length)throw new Error('The collection list is empty.');
  let importId;
  for(let offset=0;offset<inscriptionIds.length;offset+=100){
    const response=await post('/api/admin/collections/import',{
      ...details,inscriptionIds:inscriptionIds.slice(offset,offset+100),
      importId,offset,total:inscriptionIds.length,
    });
    if(offset+100<inscriptionIds.length){
      if(typeof response.importId!=='string'||!response.importId)throw new Error('The collection upload did not provide a continuation reference. Nothing should activate until the whole list is checked.');
      importId=response.importId;
    }
    onProgress(Math.min(offset+100,inscriptionIds.length),inscriptionIds.length);
  }
}
