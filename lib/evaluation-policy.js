export const DEFAULT_EVALUATION_MODEL = 'gpt-6.1-sol';
export const RUBRIC_VERSION = 'practical-completion-v2';

export const PRACTICAL_COMPLETION = `Judge practical completion of the stated task and supplied criteria, using their ordinary meaning. Do not invent extra requirements for neatness, symmetry, speed, path, technique, precision, or number of steps. Explicit constraints in the task or criteria still apply.
Minor cosmetic imperfections are compatible with pass when the requested outcome is visibly achieved. For example, "fold the dress" can succeed with a clear fold into a substantially smaller layered shape; perfect edges, wrinkle removal, a prescribed fold count, or a retail-ready rectangle are not required unless requested. Merely lifting or bunching an unfolded garment is not success. For "put/place", look for the object supported at the requested destination; fingers remaining nearby or touching it do not alone establish failure, while carrying it above the destination is insufficient.
Compare the beginning, intermediate changes, and latest state. A successful recovery counts unless the task explicitly forbids retries. Distinguish an earlier incomplete attempt from the final outcome. Judge visible task completion, not aesthetic quality.
Pass requires affirmative evidence of the requested outcome. Fail requires affirmative evidence of an unmet requested condition, not just an imperfect-looking result or inability to prove success. If a decisive detail is hidden or the ending is missing, use uncertain. Explain the decisive task condition and cite the evidence. Never change a verdict to meet an expected pass rate.`;

export function reasoningOptions(model, effort = 'low') {
  // Older non-reasoning models remain usable through an explicit local override.
  return /^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(model) ? {reasoning:{effort}} : {};
}
