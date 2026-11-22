import { RDF_TYPE, sse } from '../graph/namespaces';
import { OwlStore } from '../owl-store';

describe('OwlStore', () => {
  it('replaces a property value instead of appending a second literal', () => {
    const store = new OwlStore();
    const person = 'https://sse.local/person/p1';

    store.addEntity(person, 'Person', { name: 'A', department: '技术部' });
    store.setProperty(person, 'department', '研发部');

    const values = Array.from(store.getStore())
      .filter(
        (quad) =>
          quad.subject.value === person && quad.predicate.value === sse('department')
      )
      .map((quad) => quad.object.value);

    expect(values).toEqual(['研发部']);
    expect(
      Array.from(store.getStore()).some(
        (quad) => quad.subject.value === person && quad.predicate.value === RDF_TYPE
      )
    ).toBe(true);
  });

  it('removes incoming and outgoing quads when deleting an entity', () => {
    const store = new OwlStore();
    const dept = 'https://sse.local/dept/技术部';
    const person = 'https://sse.local/person/p1';

    store.addEntity(dept, 'Department', { name: '技术部' });
    store.addEntity(person, 'Person', { name: 'A' });
    store.addRelation(person, 'sse:belongsTo', dept);
    store.deleteEntity(dept);

    const remaining = Array.from(store.getStore())
      .filter((quad) => quad.subject.value === dept || quad.object.value === dept)
      .map((quad) => quad.subject.value);

    expect(remaining).toEqual([]);
  });
});
