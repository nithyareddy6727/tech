import OpenAI from 'openai';
import { config } from '../../config/env.js';
import { supabase } from '../../lib/supabase.js';
import { executeTool, toolDefinitions } from './tools.js';

let client;
const instructions = `You are StockSense, an inventory analyst. Use tools for every factual inventory claim. Never invent quantities, dates, product matches, or stock history. Ask a concise clarification when tools report ambiguity. Explain risk using only returned evidence and state when history is insufficient. You may create transfer or reorder drafts, but never claim an action is done: every recommendation requires human approval. Cite evidence by product, location, ledger record, and date where available. Do not discuss SQL, credentials, or internal implementation.`;

function evidenceFrom(result) {
  if (Array.isArray(result.evidence)) return result.evidence;
  return [];
}

export async function chat(message, userId) {
  if (!config.llmApiKey) {
    const error = new Error('AI is not configured. Set LLM_API_KEY on the backend.');
    error.status = 503;
    throw error;
  }
  client ||= new OpenAI({ apiKey: config.llmApiKey });
  const messages = [{ role: 'system', content: instructions }, { role: 'user', content: message }];
  const evidence = [];
  let recommendation = null;
  let answer = '';

  for (let step = 0; step < 6; step += 1) {
    const completion = await client.chat.completions.create({
      model: config.llmModel,
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.2
    });
    const assistant = completion.choices[0]?.message;
    if (!assistant) break;
    messages.push(assistant);
    if (!assistant.tool_calls?.length) {
      answer = assistant.content || '';
      break;
    }
    for (const call of assistant.tool_calls) {
      let result;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        result = await executeTool(call.function.name, args, { userId });
        evidence.push(...evidenceFrom(result));
        if (result.recommendation) {
          const saved = result.recommendation;
          recommendation = {
            id: saved.id,
            type: saved.type,
            parameters: saved.parameters,
            requiresApproval: true,
            recommendation: saved.recommendation
          };
        }
      } catch (error) {
        result = { toolError: error.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { message: answer || 'I could not complete that inventory analysis. Try a product name or ask a more specific question.', evidence, recommendation };
}

export async function approveRecommendation(id, userId) {
  const { data, error } = await supabase.rpc('approve_ai_recommendation', {
    p_recommendation_id: id,
    p_user_id: userId
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function rejectRecommendation(id, userId) {
  const { data, error } = await supabase.from('ai_recommendations').update({ status: 'REJECTED' })
    .eq('id', id).eq('created_by', userId).eq('status', 'DRAFT').select('id, status').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const missing = new Error('Draft recommendation not found or already processed.');
    missing.status = 409;
    throw missing;
  }
  return data;
}