// Embedded only inside local Docker fixtures, after their acquisition workers
// have been cancelled. n is the fixture's exact owner ID, never a real owner.
export const cleanupCorrectionFixture = `
  if(!/^ui-[a-z-]+-[a-f0-9-]{36}$/.test(n))throw Error('Invalid owned correction fixture');
  const own={ownerPlayerId:n};
  await p.correctionRetentionPin.deleteMany({where:own});
  await p.correctionCaptureOutbox.deleteMany({where:{blob:own}});
  for(const model of ['correctionExample','correctionReviewEvent','correctionEvidence','correctionLibraryAccess','correctionBlob','correctionDeletionTombstone','correctionLibraryAccount'])await p[model].deleteMany({where:own});
  {
    const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
    if(!root||!paths.isAbsolute(root))throw Error('Fixture storage unavailable');
    const library=paths.resolve(root,'correction-library-v1'),owned=paths.resolve(library,require('crypto').createHash('sha256').update(n).digest('hex'));
    if(!owned.startsWith(library+paths.sep))throw Error('Fixture namespace escaped');
    await fs.rm(owned,{recursive:true,force:true});
  }
`;
