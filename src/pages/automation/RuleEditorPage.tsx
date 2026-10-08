import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FlaskConical, Plus, Trash2, XCircle } from "lucide-react";
import { getRow, insertRow, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/format";
import {
  CONDITION_OPS, EVENT_CATALOG, eventSpec, normalizeCondition, validateRule,
  type Action, type ActionType, type Audience, type Condition, type ConditionOp, type EventSpec,
  type IssuePriority, type RuleProblem, type Severity,
} from "../../lib/automation";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type Translate } from "../../i18n";
import {
  Badge, Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Ltr, PageHeader, Select, Textarea,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { RunsTable } from "./RunsTable";
import { actionKey, eventKey, opKey } from "./labels";
import type { AutomationRule, TestResult } from "./types";

/** A condition as the form edits it: the value is always text until save. */
interface DraftCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

const AUDIENCES: Audience[] = ["managers", "admins", "all"];
const SEVERITIES: Severity[] = ["info", "warning", "critical"];
const PRIORITIES: IssuePriority[] = ["low", "normal", "high", "critical"];

const toDraft = (c: Condition): DraftCondition => ({
  field: c.field,
  op: c.op,
  value: c.value == null ? "" : Array.isArray(c.value) ? c.value.join(", ") : String(c.value),
});

function blankAction(type: ActionType): Action {
  if (type === "create_issue") return { type, title: "", priority: "normal" };
  if (type === "webhook") return { type, subscription_id: "" };
  return { type: "notify", audience: "managers", severity: "info", message: "" };
}

function problemText(t: Translate, p: RuleProblem): string {
  if (p.kind === "condition" || p.kind === "action" || p.kind === "issueNeedsVehicle") {
    return t(`automation.problem.${p.kind}`, { n: p.index + 1 });
  }
  return t(`automation.problem.${p.kind}`);
}

const samplePayload = (spec: EventSpec | undefined) => (spec ? JSON.stringify(spec.sample, null, 2) : "{}");

export default function RuleEditorPage() {
  const { ruleId = "new" } = useParams();
  const isNew = ruleId === "new";
  const t = useT();
  const { isManager } = useAuth();

  const ruleQ = useQuery({
    queryKey: ["automation_rules", "detail", ruleId],
    queryFn: () => getRow<AutomationRule>("automation_rules", ruleId),
    enabled: !isNew,
  });

  const back = (
    <Link to="/automation" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2">
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("automation.backToRules")}
    </Link>
  );

  if (!isNew && ruleQ.isLoading) return <LoadingState />;
  if (!isNew && ruleQ.error) return <ErrorState message={(ruleQ.error as Error).message} />;
  if (!isNew && !ruleQ.data) {
    return (
      <>
        {back}
        <ErrorState message={t("automation.ruleNotFound")} />
      </>
    );
  }

  return (
    <>
      {back}
      <RuleForm key={ruleQ.data?.updated_at ?? "new"} rule={ruleQ.data ?? null} canEdit={isManager} />
    </>
  );
}

function RuleForm({ rule, canEdit }: { rule: AutomationRule | null; canEdit: boolean }) {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [event, setEvent] = useState(rule?.event ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [conditions, setConditions] = useState<DraftCondition[]>((rule?.conditions ?? []).map(toDraft));
  const [actions, setActions] = useState<Action[]>(rule?.actions ?? [blankAction("notify")]);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");

  const spec = eventSpec(event);
  const events = EVENT_CATALOG.filter((e) => isEnabled(e.module) || e.event === rule?.event);
  const fieldOf = (name: string) => spec?.fields.find((f) => f.name === name);

  const normalized = useMemo(
    () => conditions.map((c) => normalizeCondition(c, spec?.fields.find((f) => f.name === c.field))),
    [conditions, spec],
  );
  const problems = validateRule({ name, event, conditions: normalized, actions });

  const save = useMutation({
    mutationFn: () => {
      const values = {
        name: name.trim(),
        description: description.trim() || null,
        event,
        active,
        conditions: normalized,
        actions: actions.map((a) =>
          a.type === "notify" ? { ...a, message: a.message.trim() } : a.type === "create_issue" ? { ...a, title: a.title.trim() } : a,
        ),
      };
      return rule
        ? updateRow<AutomationRule>("automation_rules", rule.id, values)
        : insertRow<AutomationRule>("automation_rules", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["automation_rules"] });
      toast.success(t("automation.saved"));
      setSaveError("");
      if (!rule) navigate(`/automation/rules/${saved.id}`, { replace: true });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : t("automation.saveFailed")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (problems.length === 0) save.mutate();
  };

  const setCondition = (i: number, patch: Partial<DraftCondition>) =>
    setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAction = (i: number, next: Action) => setActions((as) => as.map((a, j) => (j === i ? next : a)));

  const moduleOff = spec && !isEnabled(spec.module);
  const placeholders = spec ? spec.fields.map((f) => `{${f.name}}`).join(", ") : "";

  return (
    <>
      <PageHeader
        title={rule ? rule.name : t("automation.newRule")}
        description={rule?.description ?? t("automation.subtitle")}
        actions={
          rule ? (
            rule.active ? <Badge tone="green">{t("automation.active")}</Badge> : <Badge tone="slate">{t("automation.paused")}</Badge>
          ) : undefined
        }
      />
      {!canEdit && (
        <div className="mb-4 rounded-lg border border-line bg-canvas px-4 py-3 text-sm text-ink-2">{t("automation.readOnly")}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={submit} className="space-y-4 lg:col-span-2">
          <fieldset disabled={!canEdit} className="space-y-4">
            <Card className="space-y-4 p-4">
              <Field label={t("automation.name")} required>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </Field>
              <Field label={t("automation.description")} hint={t("automation.descriptionHint")}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </Field>
              <Field
                label={t("automation.whenEvent")}
                required
                error={moduleOff ? t("automation.eventModuleOff") : undefined}
              >
                <Select value={event} onChange={(e) => setEvent(e.target.value)}>
                  <option value="" disabled>{t("automation.chooseEvent")}</option>
                  {events.map((e) => (
                    <option key={e.event} value={e.event}>{t(eventKey(e.event))}</option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-line"
                />
                {t("automation.activeLabel")}
              </label>
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t("automation.conditions")}</h2>
                <p className="text-xs text-ink-3">{t("automation.conditionsHint")}</p>
              </div>
              {conditions.map((c, i) => {
                const field = fieldOf(c.field);
                const fields = spec?.fields ?? [];
                const knownField = fields.some((f) => f.name === c.field);
                const pickValue = field?.options && (c.op === "eq" || c.op === "neq");
                return (
                  <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-start">
                    <Select
                      value={c.field}
                      onChange={(e) => setCondition(i, { field: e.target.value })}
                      aria-label={t("automation.field")}
                      dir="ltr"
                    >
                      <option value="" disabled>{t("automation.chooseField")}</option>
                      {!knownField && c.field && <option value={c.field}>{c.field}</option>}
                      {fields.map((f) => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </Select>
                    <Select
                      value={c.op}
                      onChange={(e) => setCondition(i, { op: e.target.value as ConditionOp })}
                      aria-label={t("automation.operator")}
                    >
                      {CONDITION_OPS.map((op) => (
                        <option key={op} value={op}>{t(opKey(op))}</option>
                      ))}
                    </Select>
                    {c.op === "exists" ? (
                      <div className="hidden sm:block" />
                    ) : pickValue ? (
                      <Select value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })} aria-label={t("automation.value")} dir="ltr">
                        <option value="" disabled>{t("automation.value")}</option>
                        {field.options!.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    ) : (
                      <div>
                        <Input
                          value={c.value}
                          onChange={(e) => setCondition(i, { value: e.target.value })}
                          aria-label={t("automation.value")}
                          placeholder={c.op === "in" && field?.options ? field.options.join(", ") : t("automation.value")}
                          type={field?.kind === "date" && c.op !== "in" ? "date" : "text"}
                          inputMode={field?.kind === "number" ? "decimal" : undefined}
                          dir={field && field.kind !== "text" ? "ltr" : undefined}
                        />
                        {c.op === "in" && <p className="mt-1 text-xs text-ink-3">{t("automation.valueListHint")}</p>}
                      </div>
                    )}
                    <button
                      type="button"
                      className="justify-self-end rounded p-2 text-ink-3 hover:bg-serious-soft hover:text-serious"
                      onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}
                      aria-label={t("automation.removeCondition")}
                      title={t("automation.removeCondition")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConditions((cs) => [...cs, { field: spec?.fields[0]?.name ?? "", op: "eq", value: "" }])}
                disabled={!spec || conditions.length >= 20}
              >
                <Plus className="h-4 w-4" /> {t("automation.addCondition")}
              </Button>
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t("automation.actions")}</h2>
                <p className="text-xs text-ink-3">{t("automation.webhookUnavailable")}</p>
              </div>
              {actions.map((a, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-line p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Select
                        value={a.type}
                        onChange={(e) => setAction(i, blankAction(e.target.value as ActionType))}
                        aria-label={t("automation.actionType")}
                      >
                        <option value="notify">{t(actionKey("notify"))}</option>
                        <option value="create_issue" disabled={!isEnabled("issues") || (spec && !spec.hasVehicle)}>
                          {t(actionKey("create_issue"))}
                        </option>
                        <option value="webhook" disabled={a.type !== "webhook"}>
                          {t(actionKey("webhook"))}
                        </option>
                      </Select>
                    </div>
                    <button
                      type="button"
                      className="rounded p-2 text-ink-3 hover:bg-serious-soft hover:text-serious"
                      onClick={() => setActions((as) => as.filter((_, j) => j !== i))}
                      aria-label={t("automation.removeAction")}
                      title={t("automation.removeAction")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {a.type === "notify" && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t("automation.audience")}>
                          <Select value={a.audience} onChange={(e) => setAction(i, { ...a, audience: e.target.value as Audience })}>
                            {AUDIENCES.map((x) => (
                              <option key={x} value={x}>{t(`automation.audience.${x}`)}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={t("automation.severity")}>
                          <Select value={a.severity} onChange={(e) => setAction(i, { ...a, severity: e.target.value as Severity })}>
                            {SEVERITIES.map((x) => (
                              <option key={x} value={x}>{t(`automation.severity.${x}`)}</option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Field
                        label={t("automation.message")}
                        required
                        hint={placeholders ? t("automation.messageHint", { fields: placeholders }) : undefined}
                      >
                        <Textarea value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} rows={2} maxLength={500} />
                      </Field>
                    </>
                  )}
                  {a.type === "create_issue" && (
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                      <Field
                        label={t("automation.issueTitle")}
                        required
                        hint={placeholders ? t("automation.messageHint", { fields: placeholders }) : undefined}
                      >
                        <Input value={a.title} onChange={(e) => setAction(i, { ...a, title: e.target.value })} maxLength={200} />
                      </Field>
                      <Field label={t("automation.issuePriority")}>
                        <Select value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value as IssuePriority })}>
                          {PRIORITIES.map((x) => (
                            <option key={x} value={x}>{t(`automation.priority.${x}`)}</option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  )}
                  {a.type === "webhook" && (
                    <Field label={t("automation.webhookSubscription")}>
                      <Input value={a.subscription_id} readOnly dir="ltr" />
                    </Field>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setActions((as) => [...as, blankAction("notify")])}
                disabled={actions.length >= 10}
              >
                <Plus className="h-4 w-4" /> {t("automation.addAction")}
              </Button>
            </Card>
          </fieldset>

          {submitted && problems.length > 0 && (
            <div role="alert" className="rounded-lg border border-serious/30 bg-serious-soft px-4 py-3 text-sm text-serious">
              <ul className="list-inside list-disc space-y-1">
                {problems.map((p, i) => (
                  <li key={i}>{problemText(t, p)}</li>
                ))}
              </ul>
            </div>
          )}
          {saveError && <ErrorState message={saveError} />}
          {canEdit && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => navigate("/automation")}>{t("action.cancel")}</Button>
              <Button type="submit" loading={save.isPending}>
                {rule ? t("automation.saveRule") : t("automation.createRule")}
              </Button>
            </div>
          )}
        </form>

        <div className="space-y-4">
          {canEdit && <TestPanel spec={spec} conditions={normalized} />}
          {rule && (
            <Card className="p-4 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-ink-3">{t("automation.runs")}</dt>
                <dd className="text-end tabular-nums text-ink"><Ltr>{rule.run_count}</Ltr></dd>
                <dt className="text-ink-3">{t("automation.lastRun")}</dt>
                <dd className="text-end text-ink">
                  {rule.last_run_at ? <Ltr>{formatDateTime(rule.last_run_at, tenant.timezone)}</Ltr> : t("automation.never")}
                </dd>
              </dl>
            </Card>
          )}
        </div>
      </div>

      {rule && (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold text-ink">{t("automation.recentRuns")}</h2>
          <RunsTable ruleId={rule.id} pageSize={10} />
        </section>
      )}
    </>
  );
}

function TestPanel({ spec, conditions }: { spec: EventSpec | undefined; conditions: Condition[] }) {
  const t = useT();
  const [payload, setPayload] = useState(() => samplePayload(spec));
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  // A new event brings its own sample; an old result no longer applies.
  useEffect(() => {
    setPayload(samplePayload(spec));
    setResult(null);
    setError("");
  }, [spec]);

  const run = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error(t("automation.testInvalidJson"));
      }
      const { data, error: rpcError } = await supabase.rpc("test_automation_rule", {
        p_conditions: conditions as never,
        p_payload: parsed as never,
      });
      if (rpcError) throw wrapDbError(rpcError);
      return data as unknown as TestResult;
    },
    onSuccess: (r) => {
      setResult(r);
      setError("");
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FlaskConical className="h-4 w-4 text-ink-3" /> {t("automation.test")}
        </h2>
        <p className="text-xs text-ink-3">{t("automation.testHint")}</p>
      </div>
      <Field label={t("automation.samplePayload")}>
        <Textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={8}
          dir="ltr"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => run.mutate()} loading={run.isPending} disabled={!spec}>
          {t("automation.runTest")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPayload(samplePayload(spec))} disabled={!spec}>
          {t("automation.resetSample")}
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      {result && (
        <div className="space-y-2" aria-live="polite">
          <p className={`flex items-center gap-2 text-sm font-medium ${result.matched ? "text-good" : "text-ink-2"}`}>
            {result.matched ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {result.matched ? t("automation.testMatched") : t("automation.testNotMatched")}
          </p>
          {result.conditions.length === 0 ? (
            <p className="text-xs text-ink-3">{t("automation.testNoConditions")}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {result.conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  {c.matched ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-serious" />
                  )}
                  <span className="text-ink-2">
                    <Ltr>{c.field}</Ltr> {t(opKey(c.op))}
                    <span className="block text-ink-3">
                      {t("automation.actual")}:{" "}
                      {c.actual == null ? t("automation.missing") : <Bdi>{typeof c.actual === "string" ? c.actual : JSON.stringify(c.actual)}</Bdi>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
