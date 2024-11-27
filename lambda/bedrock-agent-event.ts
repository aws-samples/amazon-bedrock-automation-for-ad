export interface BedrockAgentEvent {
  messageVersion: string;
  agent: Agent;
  inputText: string;
  sessionId: string;
  actionGroup: string;
  function: string;
  parameters?: Parameter[];
  sessionAttributes: SessionAttributes;
  promptSessionAttributes: SessionAttributes;
}

export interface BedrockAgentResponse {
  messageVersion: string;
  response: Response;
  sessionAttributes?: SessionAttributes;
  promptSessionAttributes?: SessionAttributes;
}

export interface Agent {
  name: string;
  id: string;
  alias: string;
  version: string;
}

export interface Parameter {
  name: string;
  type: string;
  value: string;
}

export interface SessionAttributes {
  string: string;
}

export interface Response {
  actionGroup: string;
  function: string;
  functionResponse: FunctionResponse;
}

export interface FunctionResponse {
  responseState?: string;
  responseBody: ResponseBody;
}

export interface ResponseBody {
  [functionContentType: string]: FunctionContentType;
}

export interface FunctionContentType {
  body: string;
}