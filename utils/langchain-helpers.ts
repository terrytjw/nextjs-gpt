import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAI } from "langchain/llms/openai";
import { loadQAStuffChain } from "langchain/chains";
import { Document } from "langchain/document";
import { timeout } from "../config";

export const queryPineconeVectorStoreAndQueryLLM = async (
  client,
  indexName,
  question: string
) => {
  // 1. Start query process
  console.log("Querying Pinecone vector store...");

  // 2. Retrieve the Pinecone index
  const index = client.Index(indexName);

  // 3. Create query embedding: representing a query as a vector of numbers
  const queryEmbedding = await new OpenAIEmbeddings().embedQuery(question);

  // 4. Query Pinecone index and return top 10 matches
  let queryResponse = await index.query({
    queryRequest: {
      topK: 10,
      vector: queryEmbedding,
      includeMetadata: true,
      includeValues: true,
    },
  });

  // 5. Log the number of matches
  console.log(`Found ${queryResponse.matches.length} matches...`);

  // 6. Log the question being asked
  console.log(`Asking question: ${question}...`);

  if (queryResponse.matches.length) {
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // 7. Create an OpenAI instance and load the QAStuffChain
    const llm = new OpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.9,
      maxTokens: 1024, // response length
      streaming: true,
      callbacks: [
        {
          handleLLMNewToken: async (token) => {
            await writer.ready;
            await writer.write(encoder.encode(`${token}`));
          },
          handleLLMEnd: async () => {
            await writer.ready;
            await writer.close();
          },
          handleLLMError: async (e) => {
            await writer.ready;
            await writer.abort(e);
          },
        },
      ],
    });
    const chain = loadQAStuffChain(llm); // loads StuffDocumentsChain which is a chain provided by LangChain that is used for question answering tasks over a small number of documents. It simply injects all input documents into the prompt as context and returns the answer to the question.
    // 8. Extract and concatenate page content from matched documents
    const concatenatedPageContent = queryResponse.matches
      .map((match) => match.metadata.pageContent)
      .join(" ");

    // 9. Execute the chain with input documents and question
    const augmentedQuestion = `Question: ${question} 
                                Condition: End with a URL on where to find more information about the question, only if you know the answer.`;

    chain.call({
      input_documents: [new Document({ pageContent: concatenatedPageContent })],
      question: augmentedQuestion,
    });

    return stream.readable;
  } else {
    // 11. Log that there are no matches, so GPT-3 will not be queried
    console.log("Since there are no matches, GPT will not be queried.");
  }
};

export const createPineconeIndex = async (
  client,
  indexName,
  vectorDimension
) => {
  // 1. Initiate index existence check
  console.log(`Checking "${indexName}"...`);
  // 2. Get list of existing indexes
  const existingIndexes = await client.listIndexes();
  // 3. If index doesn't exist, create it
  if (!existingIndexes.includes(indexName)) {
    // 4. Log index creation initiation
    console.log(`Creating "${indexName}"...`);
    // 5. Create index
    await client.createIndex({
      createRequest: {
        name: indexName,
        dimension: vectorDimension,
        metric: "cosine",
      },
    });
    // 6. Log successful creation
    console.log(
      `Creating index.... please wait for it to finish initializing.`
    );
    // 7. Wait for index initialization
    await new Promise((resolve) => setTimeout(resolve, timeout));
  } else {
    // 8. Log if index already exists
    console.log(`"${indexName}" already exists.`);
  }
};

// upload docs to pinecone
export const updatePinecone = async (client, indexName, docs) => {
  console.log("Retrieving Pinecone index...");
  // 1. Retrieve Pinecone index
  const index = client.Index(indexName);
  // 2. Log the retrieved index name
  console.log(`Pinecone index retrieved: ${indexName}`);
  // 3. Process each document in the docs array
  for (const doc of docs) {
    console.log(`Processing document: ${doc.metadata.source}`);
    const txtPath = doc.metadata.source;
    const text = doc.pageContent;
    // 4. Create RecursiveCharacterTextSplitter instance
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
    });
    console.log("Splitting text into chunks...");
    // 5. Split text into chunks (documents)
    const chunks = await textSplitter.createDocuments([text]);
    console.log(`Text split into ${chunks.length} chunks`);
    console.log(
      `Calling OpenAI's Embedding endpoint documents with ${chunks.length} text chunks ...`
    );
    // 6. Create OpenAI embeddings for documents
    const embeddingsArrays = await new OpenAIEmbeddings().embedDocuments(
      chunks.map((chunk) => chunk.pageContent.replace(/\n/g, " ")) // remove newlines and replace with spaces
    );
    console.log("Finished embedding documents");
    console.log(
      `Creating ${chunks.length} vectors array with id, values, and metadata...`
    );
    // 7. Create and upsert vectors in batches of 100 (error when trying 100, investigate...)
    const batchSize = 10;
    let batch: any = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const vector = {
        id: `${txtPath}_${idx}`,
        values: embeddingsArrays[idx],
        metadata: {
          ...chunk.metadata,
          loc: JSON.stringify(chunk.metadata.loc),
          pageContent: chunk.pageContent,
          txtPath: txtPath,
        },
      };
      batch = [...batch, vector];
      // When batch is full or it's the last item, upsert the vectors
      if (batch.length === batchSize || idx === chunks.length - 1) {
        await index.upsert({
          upsertRequest: {
            vectors: batch,
          },
        });
        // Empty the batch
        batch = [];
      }
    }
    // 8. Log the number of vectors updated
    console.log(`Pinecone index updated with ${chunks.length} vectors`);
  }
};
