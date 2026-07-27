declare module 'n3' {
  export class Store {
    addQuad(subject: any, predicate: any, object: any, graph?: any): void;
    addQuads(quads: any[]): void;
    getQuads(subject: any, predicate: any, object: any, graph: any): any[];
    match(subject: any, predicate: any, object: any, graph?: any): any[];
    removeMatches(subject: any, predicate: any, object: any, graph?: any): void;
    createNamedNode(iri: string): any;
    createLiteral(value: string): any;
  }

  export class Parser {
    constructor(options?: { baseIRI?: string; format?: string });
    parse(data: string): any[];
  }

  export class Writer {
    constructor(options?: { format?: string });
    quadsToString(quads: any[]): string;
  }
}
