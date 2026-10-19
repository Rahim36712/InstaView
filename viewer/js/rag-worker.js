/* Indexing and searches happen off the rendering thread. */
importScripts('rag.js?v=20261001');
let retriever = null;
self.onmessage = ({ data }) => {
  try {
    const api = self.InstaViewRAG;
    let result;
    if (data.type === 'build') {
      const start = performance.now();
      const chunks = api.ConversationalChunker.chunk(data.messages, data.options);
      const index = new api.BM25Index();
      index.buildIndex(chunks);
      retriever = new api.RAGRetriever(index, data.options);
      result = { chunks: chunks.length, indexMs: performance.now() - start, worker: true };
    } else if (data.type === 'retrieve' && retriever) {
      const start = performance.now();
      result = retriever.retrieve(data.query, data.topK, data.options);
      result.searchMs = performance.now() - start;
    } else throw new Error('Index is not ready');
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
