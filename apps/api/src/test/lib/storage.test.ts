import { afterEach, expect, spyOn, test, mock } from 'bun:test';
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageBackend, directoryPrefix } from '../../storage';

afterEach(() => mock.restore());
export function backend() {
  return new S3StorageBackend({ endpoint: 'https://unused.invalid', region: 'test', bucket: 'bucket', accessKeyId: 'test', secretAccessKey: 'test' });
}

test('directory prefixes reject roots and traversal', () => {
  expect(directoryPrefix('repos/u/repo///')).toBe('repos/u/repo/');
  for (const prefix of ['', '/', '../repo', 'repos/../repo', '/repos', 'repos\\repo']) {
    expect(() => directoryPrefix(prefix)).toThrow();
  }
});

test('delete only selects children of the exact repository', async () => {
  const deleted: string[] = [];
  const keys = ['repos/u/repo/HEAD', 'repos/u/repo-backup/HEAD'];
  spyOn(S3Client.prototype, 'send').mockImplementation((async (command: { constructor: { name: string }; input: { Prefix: string; Key: string } }) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      return { Contents: keys.filter(key => key.startsWith(command.input.Prefix)).map(Key => ({Key})) };
    }
    deleted.push(command.input.Key);
    return {};
  }) as unknown as S3Client['send']);
  await backend().deletePrefix('repos/u/repo');
  expect(deleted).toEqual(['repos/u/repo/HEAD']);
});

test('copy rejects overlapping prefixes before sending requests', async () => {
  const send = spyOn(S3Client.prototype, 'send');
  await expect(backend().copyPrefix('repos/u/repo', 'repos/u/repo/copy')).rejects.toThrow('Overlapping');
  expect(send).not.toHaveBeenCalled();
});

test('adaptive retries never skip failures or repeat successful work', async () => {
  const { runAdaptiveBatch } = await import('../../storage');
  const attempts = new Map<number, number>();
  await runAdaptiveBatch([1, 2, 3], 3, 1, 3, async item => {
    const count = (attempts.get(item) ?? 0) + 1;
    attempts.set(item, count);
    if (item === 2 && count < 3) throw Object.assign(new Error('throttled'), {name: 'SlowDown'});
  });
  expect([...attempts]).toEqual([[1, 1], [2, 3], [3, 1]]);
});

test('permanent throttling rejects after a bounded number of retries', async () => {
  const { runAdaptiveBatch } = await import('../../storage');
  let attempts = 0;
  await expect(runAdaptiveBatch([1], 1, 1, 1, async () => {
    attempts++;
    throw Object.assign(new Error('throttled'), {name: 'SlowDown'});
  })).rejects.toThrow('throttled');
  expect(attempts).toBe(5);
});

test('copies on S3 without downloading bodies and preserves metadata directives', async () => {
  const calls: Array<{constructor: {name: string}; input: Record<string, unknown>}> = [];
  spyOn(S3Client.prototype, 'send').mockImplementation((async (command: typeof calls[number]) => {
    calls.push(command);
    if (command.constructor.name === 'ListObjectsV2Command') return {Contents: [{Key: 'repos/u/repo/a b', Size: 12, ETag: 'etag'}]};
    return {};
  }) as unknown as S3Client['send']);
  await backend().copyPrefix('repos/u/repo', 'repos/v/repo');
  expect(calls.map(c => c.constructor.name)).toEqual(['ListObjectsV2Command', 'CopyObjectCommand']);
  expect(calls[1].input).toMatchObject({Key: 'repos/v/repo/a b', CopySource: encodeURIComponent('bucket/repos/u/repo/a b'), CopySourceIfMatch: 'etag', MetadataDirective: 'COPY', TaggingDirective: 'COPY'});
});

test('aborts a failed multipart server-side copy', async () => {
  const calls: string[] = [];
  spyOn(S3Client.prototype, 'send').mockImplementation((async (command: {constructor: {name: string}}) => {
    const name = command.constructor.name;
    calls.push(name);
    if (name === 'ListObjectsV2Command') return {Contents: [{Key: 'repos/u/repo/pack', Size: 6 * 1024 ** 3, ETag: 'etag'}]};
    if (name === 'HeadObjectCommand') return {ContentType: 'application/octet-stream', ETag: 'etag'};
    if (name === 'CreateMultipartUploadCommand') return {UploadId: 'upload'};
    if (name === 'UploadPartCopyCommand') throw new Error('copy failed');
    return {};
  }) as unknown as S3Client['send']);
  await expect(backend().copyPrefix('repos/u/repo', 'repos/v/repo')).rejects.toThrow('copy failed');
  expect(calls).toContain('AbortMultipartUploadCommand');
  expect(calls).not.toContain('CompleteMultipartUploadCommand');
  expect(calls).not.toContain('GetObjectCommand');
});

test('multipart copy preserves metadata and completes ordered contiguous ranges', async () => {
  const ranges: string[] = [];
  const size = 5 * 1024 ** 3 + 1;
  let create: Record<string, unknown> = {};
  let completed: Array<{PartNumber: number}> = [];
  spyOn(S3Client.prototype, 'send').mockImplementation((async (command: {constructor: {name: string}; input: Record<string, unknown>}) => {
    switch (command.constructor.name) {
      case 'ListObjectsV2Command': return {Contents: [{Key: 'repos/u/repo/pack', Size: size, ETag: 'etag'}]};
      case 'HeadObjectCommand': return {ContentType: 'custom/type', Metadata: {test: 'value'}, ETag: 'etag'};
      case 'GetObjectTaggingCommand': return {TagSet: [{Key: 'a b', Value: 'c'}]};
      case 'CreateMultipartUploadCommand': create = command.input; return {UploadId: 'upload'};
      case 'UploadPartCopyCommand': ranges.push(command.input.CopySourceRange as string); return {CopyPartResult: {ETag: 'part'}};
      case 'CompleteMultipartUploadCommand': completed = (command.input.MultipartUpload as {Parts: typeof completed}).Parts; return {};
      default: throw new Error('Unexpected command');
    }
  }) as unknown as S3Client['send']);
  await backend().copyPrefix('repos/u/repo', 'repos/v/repo');
  expect(create).toMatchObject({ContentType: 'custom/type', Metadata: {test: 'value'}, Tagging: 'a+b=c'});
  expect(ranges[0]).toBe('bytes=0-134217727');
  expect(ranges.at(-1)).toBe('bytes=5368709120-5368709120');
  expect(completed.map(p => p.PartNumber)).toEqual(Array.from({length: 41}, (_, i) => i + 1));
});
