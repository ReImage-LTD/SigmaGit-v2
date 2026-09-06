import { db, users, repositories, releases, releaseAssets } from '@sigmagit/db';
import { putObject, getObject } from '../src/storage';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

export async function checkReleaseAuthorization(fixture: {
  baseURL: string;
  ownerId: string;
  repositoryId: string;
  headers: Record<string, string>;
}) {
  const { baseURL, ownerId, repositoryId, headers } = fixture;
  const [stranger] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      username: 'release-stranger',
      name: 'Stranger',
      email: 'release-stranger@example.invalid',
    })
    .returning();
  const [privateRepo] = await db
    .insert(repositories)
    .values({ ownerId: stranger.id, name: 'secret-assets', visibility: 'private' })
    .returning();
  const [ownRelease] = await db
    .insert(releases)
    .values({ repositoryId, authorId: ownerId, tagName: 'v1', name: 'Own release' })
    .returning();
  const [foreignRelease] = await db
    .insert(releases)
    .values({
      repositoryId: privateRepo.id,
      authorId: stranger.id,
      tagName: 'v1',
      name: 'Private release',
    })
    .returning();
  const addAsset = async (releaseId: string) => {
    const storageKey = `integration/assets/${crypto.randomUUID()}`;
    await putObject(storageKey, Buffer.from('asset fixture'));
    const [asset] = await db
      .insert(releaseAssets)
      .values({
        releaseId,
        name: 'asset.txt',
        contentType: 'text/plain',
        size: 13,
        storageKey,
        uploaderId: ownerId,
      })
      .returning();
    return asset;
  };
  const foreignAsset = await addAsset(foreignRelease.id);
  const ownAsset = await addAsset(ownRelease.id);
  const remove = (assetId: string) =>
    fetch(
      `${baseURL}/api/repositories/runner-test/private-test/releases/${ownRelease.id}/assets/${assetId}`,
      { method: 'DELETE', headers },
    );
  assert.equal(
    (await remove(foreignAsset.id)).status,
    404,
    'foreign release asset deletion must be rejected',
  );
  assert(await db.query.releaseAssets.findFirst({ where: eq(releaseAssets.id, foreignAsset.id) }));
  assert.equal((await getObject(foreignAsset.storageKey))?.toString(), 'asset fixture');
  assert.equal((await remove(ownAsset.id)).status, 200);
  assert.equal(
    await db.query.releaseAssets.findFirst({ where: eq(releaseAssets.id, ownAsset.id) }),
    undefined,
  );
  assert.equal(await getObject(ownAsset.storageKey), null);
  console.log(
    'PASS: release asset deletion is scoped to the authorized release and storage object',
  );
}
