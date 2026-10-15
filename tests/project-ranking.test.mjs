import test from "node:test";
import assert from "node:assert/strict";
import { rankProjects } from "../src/features/projects/project-ranking.js";

test("Les actions restent associées à leur ile", () => {
 const projects = [{slug:"a",name:"Alpha"},{slug:"b",name:"Beta"}];
 const actions = [{projectSlug:"b",statut:"En cours",echeance:"2026-10-01"},{projectSlug:"a",reviewStatus:"à valider"}];
 const order = rankProjects(projects,actions,new Date("2026-10-15T12:00:00Z"));
 assert.deepEqual(order.map(p=>p.slug),["b","a"]);
 assert.equal(order[0].overdue,1);
 assert.equal(order[1].pending,1);
});

test("Les préalertes couvrent aujourd’hui et les deux prochains jours", () => {
 const projects = [{ slug: "a", name: "Alpha" }, { slug: "b", name: "Beta" }];
 const actions = [
  {projectSlug:"a",statut:"En cours",echeance:"2026-10-15"},
  {projectSlug:"a",statut:"En cours",echeance:"2026-10-17"},
  {projectSlug:"a",statut:"En cours",echeance:"2026-10-18"},
  {projectSlug:"a",statut:"Terminé",echeance:"2026-10-16"},
  {projectSlug:"b",statut:"En cours",echeance:"2026-10-14"}
 ];
 const ranked = rankProjects(projects, actions, new Date("2026-10-15T12:00:00Z"));
 assert.equal(ranked.find(p=>p.slug==="a").upcoming,2);
 assert.equal(ranked.find(p=>p.slug==="b").upcoming,0);
 assert.equal(ranked.find(p=>p.slug==="b").overdue,1);
});
