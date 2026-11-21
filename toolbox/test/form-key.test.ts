import assert from "node:assert/strict";
import { test } from "node:test";
import { formKey } from "../src/commands/states.ts";
import type { FormErrorState } from "../src/lib/rundata.ts";

const form = (...fields: [name: string | null, type: string | null, role?: string][]): Pick<FormErrorState, "fields" | "action"> => ({
  action: null,
  fields: fields.map(([name, type, role = "textbox"]) => ({ role, name, required: false, type, invalidBeforeInput: false })),
});

test("forms whose fields have no name are told apart by the type and place of each field", () => {
  // A form to change a password and a login form, on different pages, both without names.
  assert.notEqual(formKey(form([null, "password"], [null, "password"])), formKey(form([null, "text"], [null, "password"])));
  // One checkbox and one email field.
  assert.notEqual(formKey(form([null, "checkbox", "checkbox"])), formKey(form([null, "email"])));
  // The same form on two pages is still one form.
  assert.equal(formKey(form(["Zoekterm", "search"])), formKey(form(["Zoekterm", "search"])));
  assert.equal(formKey(form([null, "email"])), formKey(form([null, "email"])));
});

test("forms that send to different addresses are never one form", () => {
  // A newsletter form and a form to be called back, each with one email field without a name.
  const newsletter = { ...form([null, "email"]), action: "post /nieuwsbrief" };
  const callback = { ...form([null, "email"]), action: "post /terugbellen" };
  assert.notEqual(formKey(newsletter), formKey(callback));
  assert.notEqual(formKey({ ...newsletter, action: "get /nieuwsbrief" }), formKey(newsletter));
  // The same newsletter form in the footer of another page is still one form.
  assert.equal(formKey(newsletter), formKey({ ...form([null, "email"]), action: "post /nieuwsbrief" }));
});
