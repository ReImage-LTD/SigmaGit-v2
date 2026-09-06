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
