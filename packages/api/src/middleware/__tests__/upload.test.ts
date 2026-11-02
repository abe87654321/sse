import { hasValidSampleSignature } from '../upload';

const pdf = Buffer.from('%PDF-1.7');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const ofd = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const cases: Array<[string, Buffer, string, boolean]> = [
  ['PDF signature', pdf, 'pdf', true],
  ['PDF with 10-byte prefix', Buffer.concat([Buffer.from('0123456789'), pdf]), 'pdf', true],
  ['arbitrary bytes', Buffer.from('hello world'), 'pdf', false],
  ['PNG signature', png, 'png', true],
  ['JPEG signature', jpeg, 'jpg', true],
  ['JPEG signature (jpeg ext)', jpeg, 'jpeg', true],
  ['OFD signature', ofd, 'ofd', true],
  ['exe extension', Buffer.from('MZ'), 'exe', false],
  ['unknown extension', Buffer.from('MZ'), 'bin', false],
  ['empty buffer', Buffer.alloc(0), 'pdf', false],
];

describe('hasValidSampleSignature', () => {
  it.each(cases)('%s', (_label, buffer, ext, expected) => {
    expect(hasValidSampleSignature(buffer, ext)).toBe(expected);
  });
});
