import { lectureFolderSchema } from "./content.controller";

/**
 * What somebody actually pastes into "Drive folder".
 *
 * Nobody opens Drive, finds the folder, and extracts the id from the address
 * bar. They select the address bar, copy, and paste the whole URL. A field that
 * refuses that is a field that blames a person for doing the obvious thing —
 * and the id it wanted was inside what they pasted all along.
 */
describe("the lecture folder field", () => {
  const parse = (v: string) => lectureFolderSchema.parse({ folderRef: v }).folderRef;

  const ID = "1Yhkvn_G0bSrIVm70xnWrzqcyG6hooKWt";

  it("takes a bare folder id", () => {
    expect(parse(ID)).toBe(ID);
  });

  it("takes the URL from the address bar", () => {
    expect(parse(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
  });

  it("takes the URL the Share dialog gives, with its query string", () => {
    expect(parse(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
  });

  it("takes the URL of somebody signed into more than one Google account", () => {
    // /u/0/ appears for everybody with a personal and a work account, which in
    // an institute is most people.
    expect(parse(`https://drive.google.com/drive/u/0/folders/${ID}?usp=drive_link`)).toBe(ID);
  });

  it("takes a FILE link too, rather than storing a URL as if it were an id", () => {
    // Pasting a recording's link instead of its folder's is a mistake somebody
    // will make. Taking the id means the folder simply reads as empty, which
    // is a fixable state; storing the whole URL means every later error names
    // a folder reference that is 60 characters of nonsense.
    const fileId = "1Nkr4Vh2hXgzPhVTHSrHQ6M1m-JIuoZoW";
    expect(parse(`https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`)).toBe(fileId);
  });

  it("trims what a copy-paste brings with it", () => {
    expect(parse(`  ${ID}  `)).toBe(ID);
  });

  it("still allows an empty value, which DISCONNECTS the folder", () => {
    // The only way to undo a mistake. An id pattern here would make a wrong
    // folder permanent.
    expect(parse("")).toBe("");
  });

  it("refuses something far too long to be a reference", () => {
    expect(() => parse("x".repeat(600))).toThrow();
  });
});
