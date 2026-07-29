declare module 'n3' {
  export class Store {
    addQuad(subject: any, predicate: any, object: any, graph?: any): void;
    addQuads(quads: any[]): void;
    getQuads(subject: any, predicate: any, object: any, graph: any): any[];
    match(subject: any, predicate: any, object: any, graph?: any): any[];
    removeMatches(subject: any, predicate: any, object: any, graph?: any): void;
    countQuads(subject: any, predicate: any, object: any, graph: any): number;
    has(quad: any): boolean;
    [Symbol.iterator](): Iterator<any>;
  }

  export class Parser {
    constructor(options?: { baseIRI?: string; format?: string });
    parse(data: string): any[];
  }

  export class Writer {
    constructor(options?: { format?: string });
    quadsToString(quads: any[]): string;
  }

  export const DataFactory: {
    namedNode(iri: string): any;
    literal(value: string): any;
  };
}
