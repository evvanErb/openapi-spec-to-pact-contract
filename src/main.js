const yaml = require('js-yaml');
const fs   = require('fs');

let savedRefs = {};
let exampleObjects = {};
let oasDirectory = "";
let inputOasFilePath = "";

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
      // Due to the recursion strucutre in resolveReferences, sub-objects should already have examples generated
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

function fetchReferences(ref) {
  // If already parsed return saved copy
  if (savedRefs.hasOwnProperty(ref)) {
    return savedRefs[ref];
  }

  // If the target is coming from a different yaml file
  if (ref.includes('.yaml') || ref.includes('.yml')) {
    const path = ref.split('#')[0];
    const componentName = ref.split('/').at(-1);
    const relativePath = oasDirectory + '/' + path.substring(path.lastIndexOf('/') + 1);
    const schema = yaml.load(fs.readFileSync(relativePath, 'utf8')).components.schemas[componentName];
    let resolvedSchema = resolveReferences(schema);
    resolvedSchema['name'] = ref;
    savedRefs[ref] = resolvedSchema;
    return resolvedSchema;
  }

  // Otherwise load from local file
  const openApiSpec = yaml.load(fs.readFileSync(inputOasFilePath, 'utf8'));
  const componentName = ref.split('/').at(-1);
  let resolvedSchema = resolveReferences(openApiSpec.components.schemas[componentName]);
  resolvedSchema['name'] = '#/components/schemas/' + componentName;
  savedRefs['#/components/schemas/' + componentName] = resolvedSchema;
  return resolvedSchema;
}

function resolveReferences(schema) {
  if (schema == null) {
    return null;
  }

  // Parse all referential schemas
  if (Object.keys(schema)[0] == '$ref') {
    return fetchReferences(schema['$ref']);
  }

  // Iterate over objects as they may have refs
  if (schema['type'] == 'object') {
    let objectName = '';
    for (propertyName in schema['properties']) {
      objectName += propertyName;
      schema['properties'][propertyName] = resolveReferences(schema['properties'][propertyName]);
    }
    generateExampleObjects(objectName, schema);
  }

  // Check array items as they may have refs
  if (schema['type'] == 'array') {
    schema['items'] = resolveReferences(schema['items']);
  }

  return schema;
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
  const parsedRequestBodySchema = resolveReferences(requestBody);
  const parsedResponseBodySchema = resolveReferences(responseBody);

  // Add Request Body
  if (parsedRequestBodySchema != null) {
    pactInteraction['request']['headers'] = {};
    pactInteraction['request']['headers']['Content-Type'] = 'application/json';
    pactInteraction['request']['body'] = generateBody(parsedRequestBodySchema);
  }

  // Add Response Body
  pactInteraction['response'] = {};
  pactInteraction['response']['status'] = 200;
  if (parsedResponseBodySchema != null) {
    pactInteraction['response']['headers'] = {};
    pactInteraction['response']['headers']['Content-Type'] = 'application/json';
    pactInteraction['response']['body'] = generateBody(parsedResponseBodySchema);
  }

  return pactInteraction;
}

function main() {
  // Load openapi spec yaml
  inputOasFilePath = process.argv.slice(2)[0];
  const openApiSpec = yaml.load(fs.readFileSync(inputOasFilePath, 'utf8'));
  oasDirectory = inputOasFilePath.substring(0, inputOasFilePath.lastIndexOf('/'));

  // Init pact contract
  let pactContract = {};
  pactContract['consumer'] = {};
  pactContract['consumer']['name'] = openApiSpec.info.title.replace(/\s+/g, '') + 'Consumer';
  pactContract['provider'] = {};
  pactContract['provider']['name'] = openApiSpec.info.title.replace(/\s+/g, '') + 'Provider';
  pactContract['interactions'] = [];
  pactContract['metadata'] = {};
  pactContract['metadata']['pactSpecification'] = {};
  pactContract['metadata']['pactSpecification']['version'] = '2.0.0';

  // Get all Paths
  for (path in openApiSpec.paths) {

    // Get all request methods for each path
    for (requestMethod in openApiSpec.paths[path]) {
      // Add Interaction
      const pactInteraction = generatePactInteraction(openApiSpec, path, requestMethod);
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