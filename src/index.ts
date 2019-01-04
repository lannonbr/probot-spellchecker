import { Application, Context } from "probot";
import { ChecksCreateParams } from "@octokit/rest";
const nodeHun = require("nodehun");
const spellcheck = require("nodehun-sentences");
import * as path from "path";
import * as fs from "fs";

var dictPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "nodehun",
  "examples",
  "dictionaries"
);

var hunspell = new nodeHun(
  fs.readFileSync(path.join(dictPath, "en_US.aff")),
  fs.readFileSync(path.join(dictPath, "en_US.dic"))
);

export = (app: Application) => {
  // Your code here
  app.log("Yay, the app was loaded!");

  app.on("check_suite.requested", processCheckSuite);
};

async function processCheckSuite(context: Context): Promise<any> {
  let sha = context.payload.check_suite.head_sha;
  let head_branch = context.payload.check_suite.head_branch;
  let pullRequests = context.payload.check_suite.pull_requests;

  let startDate = new Date();

  let status: ChecksCreateParams["status"];
  let conclusion: ChecksCreateParams["conclusion"];

  if (pullRequests.length === 0) {
    status = "completed";
    conclusion = "neutral";

    return context.github.checks.create(
      context.repo({
        head_branch,
        name: "Spell Checker",
        head_sha: sha,
        status,
        conclusion,
        started_at: startDate.toISOString(),
        completed_at: (new Date()).toISOString(),
        output: {
          title: "Spell Checker",
          summary: "No PRs found, skipping...",
          annotations: [],
          images: []
        },
        headers: {
          accept: "application/vnd.github.antiope-preview+json"
        }
      })
    );
  }

  status = "in_progress";

  let check = await context.github.checks.create(
    context.repo({
      head_branch,
      name: "Spell Checker",
      status,
      head_sha: sha,
      started_at: startDate.toISOString(),
      output: {
        title: "Spell Checker",
        summary: "Looking through markdown for spelling / grammar errors",
        annotations: [],
        images: []
      },
      headers: {
        accept: "application/vnd.github.antiope-preview+json"
      }
    })
  );

  const { number: prNumber } = pullRequests[0];

  let prFiles = await context.github.pullRequests.getFiles(
    context.repo({
      number: prNumber
    })
  );

  let spellingAnnotations: any[] = [];

  await Promise.all(
    prFiles.data.map(async file => {
      if (file.filename.endsWith(".md")) {
        let path = file.filename;
        let sha = file.blob_url.split("/")[6];

        let blob = await context.github.repos.getContent(
          context.repo({
            path: path,
            ref: sha
          })
        );

        let fileContent = await Buffer.from(
          blob.data.content,
          "base64"
        ).toString("ascii");

        let possibleErrors = await checkSpelling(fileContent);

        for (let { word, suggestions, positions } of possibleErrors) {
          let lineNumber = fileContent.slice(0, positions[0].from).split("\n")
            .length;

          spellingAnnotations.push({
            path: path,
            annotation_level: "failure",
            title: "Mispelled word",
            message: `The word ${word} was found on line ${lineNumber}. Did you mean ${
              suggestions[0]
            }?`,
            start_line: `${lineNumber}`,
            end_line: `${lineNumber}`
          });
        }
      }
    })
  );

  let endDate = new Date();

  if (spellingAnnotations.length === 0) {
    status = "completed";
    conclusion = "success";

    return context.github.checks.update(
      context.repo({
        check_run_id: check.data.id,
        name: "Spell Checker",
        status,
        conclusion,
        started_at: startDate.toISOString(),
        completed_at: endDate.toISOString(),
        output: {
          title: "Spellchecker passed",
          summary: "No spelling errors!",
          annotations: [],
          images: []
        },
        headers: {
          accept: "application/vnd.github.antiope-preview+json"
        }
      })
    );
  } else {
    status = "completed";
    conclusion = "action_required";

    return context.github.checks.update(
      context.repo({
        check_run_id: check.data.id,
        name: "Spell Checker",
        status,
        conclusion,
        started_at: startDate.toISOString(),
        completed_at: endDate.toISOString(),
        output: {
          title: "Spellchecker Failed",
          summary: "We found some spelling errors, please go fix them",
          annotations: spellingAnnotations,
          images: []
        },
        headers: {
          accept: "application/vnd.github.antiope-preview+json"
        }
      })
    );
  }
}

async function checkSpelling(fileContent: string): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    spellcheck(hunspell, fileContent, function(err: any, typos: any) {
      if (err) {
        reject(err);
      }

      resolve(typos);
    });
  });
}
