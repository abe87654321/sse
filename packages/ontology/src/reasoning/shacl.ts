import { DataFactory, Parser, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { GRAPH } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';

const SH = 'http://www.w3.org/ns/shacl#';
const { namedNode } = DataFactory;

export interface ShaclViolation {
  focusNode: string;
  path?: string;
  message: string;
  severity?: string;
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function datasetFromTurtle(ttl: string): Store {
  const dataset = new Store();
  dataset.addQuads(new Parser().parse(ttl));
  return dataset;
}

function datasetFromNQuads(nquads: string): Store {
  const dataset = new Store();
  dataset.addQuads(new Parser({ format: 'application/n-quads' }).parse(nquads));
  return dataset;
}

/**
 * Validate the queryable dataset (TBox + data + inferred + manual) against the
 * SHACL shapes. Results are read from `report.dataset`, not from version-
 * specific structured fields.
 */
export async function validateGraph(store: GraphStore, shapesTtl: string): Promise<ShaclViolation[]> {
  const dataNq = await store.dump([GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.manual]);
  const data = datasetFromNQuads(dataNq);
  const shapes = datasetFromTurtle(shapesTtl);

  const validator = new SHACLValidator(shapes as any);
  const report: any = await validator.validate(data as any);

  const reportDataset = report?.dataset;
  if (!reportDataset) {
    throw new Error('SHACL report has no dataset; pin rdf-validate-shacl to 0.6.x');
  }

  return Array.from(reportDataset.match(null, namedNode(`${SH}focusNode`), null) as Iterable<any>)
    .map((focusQuad: any) => {
      const resultNode = focusQuad.subject;
      const messages = Array.from(
        reportDataset.match(resultNode, namedNode(`${SH}resultMessage`), null) as Iterable<any>,
      ).map((quad: any) => quad.object.value);
      const path = Array.from(
        reportDataset.match(resultNode, namedNode(`${SH}resultPath`), null) as Iterable<any>,
      )[0]?.object?.value;
      const severity = Array.from(
        reportDataset.match(resultNode, namedNode(`${SH}resultSeverity`), null) as Iterable<any>,
      )[0]?.object?.value;

      return {
        focusNode: focusQuad.object.value,
        ...(path ? { path } : {}),
        message: messages.join('; '),
        ...(severity ? { severity: localName(severity) } : {}),
      };
    });
}
