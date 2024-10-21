const yaml = require('js-yaml');
const fs   = require('fs');

let savedRefs = {};
let exampleObjects = {};

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
    // TODO create a set of 3 for other types
  } else if (schema['type'] == 'object') {
    // If it is an object return first example object
    return exampleObjects[Object.keys(schema['properties']).join('')][0];
  }
  // TODO return examples for non arrays or objects
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
    if (currentProperty['type'] == 'string') {
      if (currentProperty['format'] != null && currentProperty['format'] == 'uuid') {
        exampleOne[propertyName] = generateUUID();
        exampleTwo[propertyName] = generateUUID();
        exampleThree[propertyName] = generateUUID();
      } else {
        exampleOne[propertyName] = generateRandomString(10);
        exampleTwo[propertyName] = generateRandomString(10);
        exampleThree[propertyName] = generateRandomString(10);
      }
    } else if (currentProperty['type'] == 'integer') {
      exampleOne[propertyName] = Math.floor(Math.random() * (100 - 1 + 1)) + 1;
      exampleTwo[propertyName] = Math.floor(Math.random() * (100 - 1 + 1)) + 1;
      exampleThree[propertyName] = Math.floor(Math.random() * (100 - 1 + 1)) + 1;
    } else if (currentProperty['type'] == 'number') {
      exampleOne[propertyName] = Math.round((Math.random() * (1 - 100) + 1) * 100) / 100;
      exampleTwo[propertyName] = Math.round((Math.random() * (1 - 100) + 1) * 100) / 100;
      exampleThree[propertyName] = Math.round((Math.random() * (1 - 100) + 1) * 100) / 100;
    } else if (currentProperty['type'] == 'boolean') {
      exampleOne[propertyName] = true;
      exampleTwo[propertyName] = true;
      exampleThree[propertyName] = true;
    } else if (currentProperty['type'] == 'array') {
      // TODO
    } else if (currentProperty['type'] == 'object') {
      // Due to the recursion strucutre in resolveReferences, sub-objects should already have examples generated
      const subObjectName = Object.keys(currentProperty['properties']).join('');
      exampleOne[propertyName] = exampleObjects[subObjectName][0];
      exampleTwo[propertyName] = exampleObjects[subObjectName][1];
      exampleThree[propertyName] = exampleObjects[subObjectName][2];
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
    const schema = yaml.load(fs.readFileSync(path, 'utf8')).components.schemas[componentName];
    let resolvedSchema = resolveReferences(schema);
    resolvedSchema['name'] = ref;
    savedRefs[ref] = resolvedSchema;
    return resolvedSchema;
  }

  // Otherwise load from local file
  const openApiSpec = yaml.load(fs.readFileSync('./exampleOAS.yaml', 'utf8'));
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

function main() {
  // Load openapi spec yaml
  const openApiSpec = yaml.load(fs.readFileSync(process.argv.slice(2)[0], 'utf8'));

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

      // Add interaction
      pactContract['interactions'].push(pactInteraction);
    }
  }

  fs.writeFileSync('examplePactContract.json', JSON.stringify(pactContract, null, 2), 'utf8');
}

main();