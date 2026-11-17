(ns metabase.server.middleware.worktree
  "Runs a request in the remote sync worktree its host names, a subdomain of the site URL."
  (:require
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.app-db.core :as mdb]
   [metabase.server.db :as server.db]
   [metabase.system.core :as system]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]])
  (:import
   (java.net URI)))

(set! *warn-on-reflection* true)

(defn- site-host
  "The host of the site URL, or nil before it is set."
  []
  (some-> (system/site-url) URI. .getHost u/lower-case-en))

(defn- subdomain
  "The single label the host of `request` adds in front of the host of the site URL, or nil."
  [{:keys [server-name]}]
  (when-let [site-host (and (= :postgres (mdb/db-type)) server-name (site-host))]
    (let [host   (u/lower-case-en server-name)
          suffix (str "." site-host)]
      (when (str/ends-with? host suffix)
        (let [label (subs host 0 (- (count host) (count suffix)))]
          (when-not (str/includes? label ".")
            label))))))

(defn wrap-worktree
  "Middleware that binds [[api/*worktree-id*]] and the worktree of the app DB connections to the worktree a request's
  host opens, a subdomain of the site URL, answering 404 when no worktree opens there."
  [handler]
  (fn [request respond raise]
    (if-let [label (subdomain request)]
      (if-let [worktree-id (server.db/subdomain-worktree-id label)]
        (binding [api/*worktree-id* worktree-id]
          (mdb/with-worktree-id worktree-id
            (handler request respond raise)))
        (respond {:status  404
                  :headers {"Content-Type" "text/plain"}
                  :body    (tru "There is no worktree at {0}." label)}))
      (handler request respond raise))))
