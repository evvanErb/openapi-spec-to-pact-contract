const yaml = require('js-yaml');
const fs   = require('fs');
const path_lib = require('path');

/* Deal with generating pact interactions */

function generateBody(schema) {
  if (schema['type'] == 'array') {
    // If it is an array of objects get all 3 example objects
    if (schema['items']['type'] == 'object') {
      let objectName = Object.keys(schema['items']['properties']).join('');
      return [
        exampleObjects[objectName][0],
        exampleObjects[objectName][1],
        exampleObjects[objectName][2],
      ]
    }
    // For other types
    return generateExampleArray(schema['items']['type']);
  } else if (schema['type'] == 'object') {
    // If it is an object return first example object
    return exampleObjects[Object.keys(schema['properties']).join('')][0];
  }
  // Return singular example for non arrays or objects
  return generateExampleItem(schema['type']);
}

function generatePactInteraction(openApiSpec, path, requestMethod) {
  // Init the current pact interaction
  let pactInteraction = {};
  pactInteraction['description'] = path + " " + requestMethod;
  pactInteraction['providerStates'] = [];
  let providerState = {};
  providerState['name'] = path + " " + requestMethod;
  pactInteraction['providerStates'].push(providerState);
  // Add request info
  pactInteraction['request'] = {};
  pactInteraction['request']['method'] = requestMethod.toUpperCase();
  pactInteraction['request']['path'] = path;

  // Get successful request and response bodies for each request method
  let requestBody = null;
  let responseBody = null;
  if (openApiSpec.paths[path][requestMethod].requestBody != null) {
    requestBody = openApiSpec.paths[path][requestMethod].requestBody.content['application/json'].schema;
  }
  if (openApiSpec.paths[path][requestMethod].responses['200'] != null && openApiSpec.paths[path][requestMethod].responses['200'].content != null) {
    responseBody = openApiSpec.paths[path][requestMethod].responses['200'].content['application/json'].schema;
  }

  // Add Request Body
  if (requestBody != null) {
    pactInteraction['request']['headers'] = {};
    pactInteraction['request']['headers']['Content-Type'] = 'application/json';
    pactInteraction['request']['body'] = generateBody(requestBody);
  }

  // Add Response Body
  pactInteraction['response'] = {};
  pactInteraction['response']['status'] = 200;
  if (responseBody != null) {
    pactInteraction['response']['headers'] = {};
    pactInteraction['response']['headers']['Content-Type'] = 'application/json';
    pactInteraction['response']['body'] = generateBody(responseBody);
  }

  return pactInteraction;
}

/* Deal with generating example objects */

let exampleObjects = {};

function generateInsertExampleSql() {
  // TODO deal with sub objects
  let sql = "";
  // Iterate over all types of example objects
  for (const objectName of Object.keys(exampleObjects)) {
    // Iterate over all 3 generated examples of that type
    for (const exampleObject of exampleObjects[objectName]) {
      sql += "INSERT INTO " + objectName + " (";
      // Iterate over all properties for that object
      for (const property of Object.keys(exampleObject)) {
        sql += property + ", ";
      }
      sql = sql.slice(0, -2) + ") VALUES (";
      for (const property of Object.keys(exampleObject)) {
        sql += exampleObject[property] + ", ";
      }
      sql = sql.slice(0, -2) + ");\n";
    }
    sql += "\n";
  }
  return sql;
}

function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }

  return result;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8); 
    return v.toString(16);
  });
}

function generateExampleItem(type) {
  if (type == 'string') {
    return generateRandomString(10);
  } else if (type == 'uuid') {
    return generateUUID();
  } else if (type == 'integer') {
   return (Math.floor(Math.random() * (100 - 1 + 1)) + 1);
  } else if (type== 'number') {
    return (Math.round((Math.random() * (1 - 100) + 1) * 100) / 100);
  } else if (type == 'boolean') {
    return true;
  } else {
    return null;
  }
}

function generateExampleArray(type) {
  // TODO handle nested arrays
  let returnArray = [];
  returnArray.push(generateExampleItem(type));
  returnArray.push(generateExampleItem(type));
  returnArray.push(generateExampleItem(type));
  return returnArray;
}

function generateExampleObjects(objectName, schema) {
  // If already generated return objectName copy
  if (exampleObjects.hasOwnProperty(objectName)) {
    return exampleObjects[objectName];
  }

  let exampleOne = {};
  let exampleTwo = {};
  let exampleThree = {};

  // Generate example data for each property by type
  for (propertyName in schema['properties']) {
    let currentProperty = schema['properties'][propertyName];
    // Get the type
    let type = currentProperty['type'];
    if (currentProperty['type'] == 'string') {
      if (currentProperty['format'] != null && currentProperty['format'] == 'uuid') {
        type = 'uuid';
      }
    }

    if (type == 'array') {
      exampleOne[propertyName] = generateExampleArray(currentProperty['items']['type']);
      exampleTwo[propertyName] = generateExampleArray(currentProperty['items']['type']);
      exampleThree[propertyName] = generateExampleArray(currentProperty['items']['type']);
    } else if (type == 'object') {
      // Due to the recursion strucutre in generateExamples, sub-objects should already have examples generated
      const subObjectName = Object.keys(currentProperty['properties']).join('');
      exampleOne[propertyName] = exampleObjects[subObjectName][0];
      exampleTwo[propertyName] = exampleObjects[subObjectName][1];
      exampleThree[propertyName] = exampleObjects[subObjectName][2];
    } else {
      exampleOne[propertyName] = generateExampleItem(type);
      exampleTwo[propertyName] = generateExampleItem(type);
      exampleThree[propertyName] = generateExampleItem(type);
    }
  }

  // Save and return example objects
  const examples = [exampleOne, exampleTwo, exampleThree]
  exampleObjects[objectName] = examples;
  return examples;
}

function generateExamples(schema) {
  if (schema == null || typeof schema !== 'object') {
    return schema;
  }
  
  if (schema['type'] != null && schema['type'] === 'object') {
    let objectName = '';
    for (const propertyName of Object.keys(schema['properties'])) {
      objectName += propertyName;
      // Recursively generate all sub objects first
      generateExamples(schema['properties'][propertyName]);
    }
    // Generate 3 examples for this Object type
    generateExampleObjects(objectName, schema);
  } else {
    // Recursively generate for nested objects
    for (const key of Object.keys(schema)) {
      generateExamples(schema[key]);
    }
  }
}

/* Deal with fethcing and resolving references */

let fetchedReferences = {};
let inputOasFilePath = "";

function fetchReferences(ref, absoluteCurrentFilePath) {

  // Load target openapi spec
  let absoluteNextFilePath = absoluteCurrentFilePath;

  // If the target is coming from a different yaml file Otherwise load from local file
  if (ref.includes('.yaml') || ref.includes('.yml')) {
    const relativeTargetPath = ref.split('#/')[0];

    const absoluteCurrentDirPath = absoluteCurrentFilePath.substring(0, absoluteCurrentFilePath.lastIndexOf('/')) + '/';
    absoluteNextFilePath = path_lib.resolve(absoluteCurrentDirPath, relativeTargetPath);
  }
  
  let openApiSpec = yaml.load(fs.readFileSync(absoluteNextFilePath, 'utf8'));

  // Get target component to resolve
  const targetObjectStructure = ref.split('#/')[1];
  const targetObjectStructureParts = targetObjectStructure.split('/');

  let targetComponentSchema = openApiSpec;
  for (const part of targetObjectStructureParts) {
    targetComponentSchema = targetComponentSchema[part];
  }

  const resolvedSchema = resolveReferences(targetComponentSchema, absoluteNextFilePath);
  fetchedReferences[ref] = resolvedSchema;
  return resolvedSchema;
}

function resolveReferences(schema, absoluteCurrentFilePath) {
  if (schema == null) {
    return null;
  }

  if (typeof schema !== 'object') {
    return schema;
  }

  for (const key of Object.keys(schema)) {
    if (key === '$ref') {
      // Fetch the referenced schema and store it to avoid re-fetching, return resolved schema
      fetchReferences(schema['$ref'], absoluteCurrentFilePath);
      return fetchedReferences[schema['$ref']];
    } else {
      // Recursively resolve for nested objects
      schema[key] = resolveReferences(schema[key], absoluteCurrentFilePath);
    }
  }

  return schema;
}

/*
1. Resolve all references at all levels in the schema
2. Iterate through schema and for all objects generate examples
3. Init pact contract
3. Build pact interactions for each path 
4. Output pact contract, example objects, example objects as insert sql
*/

function main() {
  // Load openapi spec yaml
  inputOasFilePath = process.argv.slice(2)[0];
  const absoluteFilePath = (path_lib.isAbsolute(inputOasFilePath) ? inputOasFilePath : path_lib.resolve(__dirname, inputOasFilePath)).replace(/\\/g, '/');
  const openApiSpec = yaml.load(fs.readFileSync(inputOasFilePath, 'utf8'));
  const unifiedOpenApiSpec = resolveReferences(openApiSpec, absoluteFilePath);
  fs.writeFileSync('./example_outputs/unifiedOAS.yaml', JSON.stringify(unifiedOpenApiSpec, null, 2), 'utf8');

  // Generate example objects
  generateExamples(unifiedOpenApiSpec);

  // Init pact contract
  let pactContract = {};
  pactContract['consumer'] = {};
  pactContract['consumer']['name'] = unifiedOpenApiSpec.info.title.replace(/\s+/g, '') + 'Consumer';
  pactContract['provider'] = {};
  pactContract['provider']['name'] = unifiedOpenApiSpec.info.title.replace(/\s+/g, '') + 'Provider';
  pactContract['interactions'] = [];
  pactContract['metadata'] = {};
  pactContract['metadata']['pactSpecification'] = {};
  pactContract['metadata']['pactSpecification']['version'] = '2.0.0';

  // Get all Paths
  for (path in unifiedOpenApiSpec.paths) {

    // Get all request methods for each path
    for (requestMethod in unifiedOpenApiSpec.paths[path]) {
      // Add Interaction
      const pactInteraction = generatePactInteraction(unifiedOpenApiSpec, path, requestMethod);
      pactContract['interactions'].push(pactInteraction);
    }
  }

  // Output pact contract
  fs.writeFileSync('./example_outputs/examplePactContract.json', JSON.stringify(pactContract, null, 2), 'utf8');
  // Output example objects
  fs.writeFileSync('./example_outputs/exampleObjects.json', JSON.stringify(exampleObjects, null, 2), 'utf8');
  // Output example objects as insert SQL
  fs.writeFileSync('./example_outputs/exampleObjectsInsert.sql', generateInsertExampleSql(), 'utf8');
}

main();
