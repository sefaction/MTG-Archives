// Embedded only in already-cancelled local fixture teardowns. Keep all recovery
// rows until every independently owned file has been attempted successfully.
function ownedFiles(ids: string, namespace: string, suffixes: readonly string[]) {
  return `{ const fixtureIds=[...new Set(${ids})];
    const fixtureFs=require('fs/promises'),fixturePath=require('path'),fixtureRoot=process.env.UPLOADS_DATA_PATH;
    if(!fixtureRoot||!fixturePath.isAbsolute(fixtureRoot))throw Error('Private fixture root unavailable');
    for(const id of fixtureIds)if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid owned fixture file identity');
    fixtureIds.sort();
    const fixtureFileErrors=[];
    for(const id of fixtureIds)for(const suffix of ${JSON.stringify(suffixes)}){
      try{await fixtureFs.unlink(fixturePath.join(fixtureRoot,${JSON.stringify(namespace)},id+suffix));}
      catch(error){if(error?.code!=='ENOENT')fixtureFileErrors.push(error);}
    }
    if(fixtureFileErrors.length)throw new AggregateError(fixtureFileErrors,'Owned fixture file cleanup incomplete; preserve recovery rows');
  }`;
}

export const cleanupOwnedPhotoFixtureFiles = ownedFiles(
  'photos.map(photo=>photo.id)', 'acquisition-v1', ['.original', '.preview.jpg'],
);
export const cleanupOwnedScannerStartFiles = ownedFiles(
  'fixtureScannerIds', 'scanner-control-v1', ['.start.json'],
);
export const cleanupOwnedScannerStateFiles = ownedFiles(
  'fixtureScannerIds', 'scanner-control-v1', ['.start.json', '.retired.json'],
);
