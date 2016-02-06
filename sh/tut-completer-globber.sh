#
# Script @completer from content/tutorials/setup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'envVars' (1/1 in completer) of content/tutorials/setup.md"
####
# If JIRI_ROOT or V23_RELEASE are not defined, set them to the default values
# from the installation instructions and hope for the best.

[ -z "$JIRI_ROOT" ] && export JIRI_ROOT=${HOME}/v23_root
[ -z "$V23_RELEASE" ] && export V23_RELEASE=${JIRI_ROOT}/release/go

# All files created by the tutorial will be placed in $V_TUT. It is a disposable
# workspace, easy to recreate.
export V_TUT=${V_TUT-$HOME/v23_tutorial}

# V_BIN is a convenience for running Vanadium binaries. It avoids the need to
# modify your PATH or to be 'in' a particular directory when doing the
# tutorials.
export V_BIN=${V23_RELEASE}/bin

# For the shell doing the tutorials, GOPATH must include both Vanadium and the
# code created as a result of doing the tutorials. To avoid trouble with
# accumulation, $GOPATH is intentionally omitted from the right hand side (any
# existing value is ignored).
if [ -z "$V23_GOPATH" ]; then
  export V23_GOPATH=`${JIRI_ROOT}/devtools/bin/jiri go env GOPATH`
fi
export GOPATH=$V_TUT:${V23_GOPATH}

# HISTCONTROL set as follows excludes long file creation commands used in
# tutorials from your shell history.
HISTCONTROL=ignorespace

# A convenience for killing tutorial processes
function kill_tut_process() {
  eval local pid=\$$1
  if [ -n "$pid" ]; then
    kill $pid || true
    wait $pid || true
    eval unset $1
  fi
}
#----------------------------------------------------------------------#  End 1

 bash -e <<'HANDLED_SCRIPT'
function handledTrouble() {
  echo " "
  echo "Unable to continue!"
  exit 1
}
trap handledTrouble INT TERM
#
# Script @completer from content/tutorials/setup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'envVars' (1/1 in completer) of content/tutorials/setup.md"
####
# If JIRI_ROOT or V23_RELEASE are not defined, set them to the default values
# from the installation instructions and hope for the best.

[ -z "$JIRI_ROOT" ] && export JIRI_ROOT=${HOME}/v23_root
[ -z "$V23_RELEASE" ] && export V23_RELEASE=${JIRI_ROOT}/release/go

# All files created by the tutorial will be placed in $V_TUT. It is a disposable
# workspace, easy to recreate.
export V_TUT=${V_TUT-$HOME/v23_tutorial}

# V_BIN is a convenience for running Vanadium binaries. It avoids the need to
# modify your PATH or to be 'in' a particular directory when doing the
# tutorials.
export V_BIN=${V23_RELEASE}/bin

# For the shell doing the tutorials, GOPATH must include both Vanadium and the
# code created as a result of doing the tutorials. To avoid trouble with
# accumulation, $GOPATH is intentionally omitted from the right hand side (any
# existing value is ignored).
if [ -z "$V23_GOPATH" ]; then
  export V23_GOPATH=`${JIRI_ROOT}/devtools/bin/jiri go env GOPATH`
fi
export GOPATH=$V_TUT:${V23_GOPATH}

# HISTCONTROL set as follows excludes long file creation commands used in
# tutorials from your shell history.
HISTCONTROL=ignorespace

# A convenience for killing tutorial processes
function kill_tut_process() {
  eval local pid=\$$1
  if [ -n "$pid" ]; then
    kill $pid || true
    wait $pid || true
    eval unset $1
  fi
}
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/checkup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'checkTutorialAssets' (1/1 in completer) of content/tutorials/checkup.md"
####
function bad_vanadium() {
  echo '
  Per https://vanadium.github.io/installation/, either

    export JIRI_ROOT={your installation directory}

  or do a fresh install.';
  exit 1;
}

[ -z "$V23_RELEASE" ] && { echo 'The environment variable V23_RELEASE is not defined.'; bad_vanadium; }

[ -x "$V23_RELEASE/bin/principal" ] || { echo 'The file $V23_RELEASE/bin/principal does not exist or is not executable.'; bad_vanadium; }
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/wipe-slate.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'deleteTutdirContent' (1/1 in completer) of content/tutorials/wipe-slate.md"
####
if [ -z "${V_TUT}" ]; then
  echo "V_TUT not defined, nothing to do."
else
  if [ -d "${V_TUT}" ]; then
    /bin/rm -rf $V_TUT/*
    echo "Removed contents of $V_TUT"
  else
    echo "Not a directory: V_TUT=\"$V_TUT\""
  fi
fi
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/basics.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'defineService' (1/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/ifc
 cat - <<EOF >$V_TUT/src/fortune/ifc/fortune.vdl
package ifc

type Fortune interface {
  // Returns a random fortune.
  Get() (wisdom string | error)
  // Adds a fortune to the set used by Get().
  Add(wisdom string) error
}
EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'compileInterface' (2/9 in completer) of content/tutorials/basics.md"
####
VDLROOT=$V23_RELEASE/src/v.io/v23/vdlroot \
    VDLPATH=$V_TUT/src \
    $V_BIN/vdl generate --lang go $V_TUT/src/fortune/ifc
go build fortune/ifc
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'serviceImpl' (3/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/service
 cat - <<EOF >$V_TUT/src/fortune/service/service.go
package service

import (
  "math/rand"
  "fortune/ifc"
  "sync"
  "v.io/v23/context"
  "v.io/v23/rpc"
)

type impl struct {
  wisdom []string      // All known fortunes.
  random *rand.Rand    // To pick a random index in 'wisdom'.
  mu     sync.RWMutex  // To safely enable concurrent use.
}

// Makes an implementation.
func Make() ifc.FortuneServerMethods {
  return &impl {
    wisdom: []string{
        "You will reach the heights of success.",
        "Conquer your fears or they will conquer you.",
        "Today is your lucky day!",
    },
    random: rand.New(rand.NewSource(99)),
  }
}

func (f *impl) Get(_ *context.T, _ rpc.ServerCall) (blah string, err error) {
  f.mu.RLock()
  defer f.mu.RUnlock()
  if len(f.wisdom) == 0 {
    return "[empty]", nil
  }
  return f.wisdom[f.random.Intn(len(f.wisdom))], nil
}

func (f *impl) Add(_ *context.T, _ rpc.ServerCall, blah string) error {
  f.mu.Lock()
  defer f.mu.Unlock()
  f.wisdom = append(f.wisdom, blah)
  return nil
}
EOF
go build fortune/service
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'authorizer' (4/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/authorizer.go
package util

import (
  "v.io/v23/security"
)

// Returns Vanadium's default authorizer.
func MakeAuthorizer() security.Authorizer {
  return security.DefaultAuthorizer()
}
EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'dispatcher' (5/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/dispatcher.go
package util

import (
  "v.io/v23/rpc"
)

// Returns nil to trigger use of the default dispatcher.
func MakeDispatcher() (d rpc.Dispatcher) {
  return nil
}
EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'intializer' (6/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/initializer.go
package util

import (
  "flag"
  "fmt"
  "io/ioutil"
  "log"

  "v.io/v23/naming"
)

var (
  fileName = flag.String(
      "endpoint-file-name", "",
      "Write endpoint address to given file.")
)

func SaveEndpointToFile(e naming.Endpoint) {
  if *fileName == "" {
    return
  }
  contents := []byte(
      naming.JoinAddressName(e.String(), "") + "\n")
  if ioutil.WriteFile(*fileName, contents, 0644) != nil {
    log.Panic("Error writing ", *fileName)
  }
  fmt.Printf("Wrote endpoint name to %v.\n", *fileName)
}

EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'server' (7/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server
 cat - <<EOF >$V_TUT/src/fortune/server/main.go
package main

import (
  "flag"
  "fmt"
  "log"
  "fortune/ifc"
  "fortune/server/util"
  "fortune/service"

  "v.io/v23"
  "v.io/v23/rpc"
  "v.io/x/ref/lib/signals"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  serviceName = flag.String(
      "service-name", "",
      "Name for service in default mount table.")
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

  // Attach the 'fortune service' implementation
  // defined above to a queriable, textual description
  // of the implementation used for service discovery.
  fortune := ifc.FortuneServer(service.Make())

  // If the dispatcher isn't nil, it's presumed to have
  // obtained its authorizer from util.MakeAuthorizer().
  dispatcher := util.MakeDispatcher()

  // Start serving.
  var err error
  var server rpc.Server
  if dispatcher == nil {
    // Use the default dispatcher.
    _, server, err = v23.WithNewServer(
        ctx, *serviceName, fortune, util.MakeAuthorizer())
  } else {
    _, server, err = v23.WithNewDispatchingServer(
        ctx, *serviceName, dispatcher)
  }
  if err != nil {
    log.Panic("Error serving service: ", err)
  }
  endpoint := server.Status().Endpoints[0]
  util.SaveEndpointToFile(endpoint)
  fmt.Printf("Listening at: %v\n", endpoint)

  // Wait forever.
  <-signals.ShutdownOnSignals(ctx)
}
EOF
go install fortune/server
#----------------------------------------------------------------------#  End 7

#----------------------------------------------------------------------#  Start 8
echo "Block 'client' (8/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/client
 cat - <<EOF >$V_TUT/src/fortune/client/main.go
package main

import (
  "flag"
  "fmt"
  "time"

  "fortune/ifc"

  "v.io/v23"
  "v.io/v23/context"
  "v.io/x/lib/vlog"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  server = flag.String(
      "server", "", "Name of the server to connect to")
  newFortune = flag.String(
      "add", "", "A new fortune to add to the server's set")
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

  if *server == "" {
    vlog.Error("--server must be specified")
    return
  }
  f := ifc.FortuneClient(*server)
  ctx, cancel := context.WithTimeout(ctx, time.Minute)
  defer cancel()

  if *newFortune == "" { // --add flag not specified
    fortune, err := f.Get(ctx)
    if err != nil {
      vlog.Errorf("error getting fortune: %v", err)
      return
    }
    fmt.Println(fortune)
  } else {
    if err := f.Add(ctx, *newFortune); err != nil {
      vlog.Errorf("error adding fortune: %v", err)
      return
    }
  }
}
EOF
go install fortune/client
#----------------------------------------------------------------------#  End 8

#----------------------------------------------------------------------#  Start 9
echo "Block 'principalTutorial' (9/9 in completer) of content/tutorials/basics.md"
####
$V_BIN/principal create \
    --overwrite $V_TUT/cred/basics tutorial
#----------------------------------------------------------------------#  End 9

#
# Script @completer from content/tutorials/security/principals-and-blessings.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'makeAliceAndBob' (1/2 in completer) of content/tutorials/security/principals-and-blessings.md"
####
$V_BIN/principal create --overwrite $V_TUT/cred/alice alice
$V_BIN/principal create --overwrite $V_TUT/cred/bob bob
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'aliceBlessBobAsFriend' (2/2 in completer) of content/tutorials/security/principals-and-blessings.md"
####
$V_BIN/principal bless \
    --v23.credentials $V_TUT/cred/alice \
    --for=24h $V_TUT/cred/bob friend:bob | \
        $V_BIN/principal \
            --v23.credentials $V_TUT/cred/bob \
            set forpeer - alice
#----------------------------------------------------------------------#  End 2

#
# Script @completer from content/tutorials/security/permissions-authorizer.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'fortuneInterfaceWithTags' (1/4 in completer) of content/tutorials/security/permissions-authorizer.md"
####
 cat - <<EOF >$V_TUT/src/fortune/ifc/fortune.vdl
package ifc

type MyTag string
const (
  Reader = MyTag("R")
  Writer = MyTag("W")
)

type Fortune interface {
  // Returns a random fortune.
  Get() (Fortune string | error) {Reader}
  // Adds a fortune to the set used by Get().
  Add(Fortune string) error {Writer}
}
EOF

VDLROOT=$V23_RELEASE/src/v.io/v23/vdlroot \
    VDLPATH=$V_TUT/src \
    $V_BIN/vdl generate --lang go $V_TUT/src/fortune/ifc
go build fortune/ifc
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'permissionsAuthorizer' (2/4 in completer) of content/tutorials/security/permissions-authorizer.md"
####
 cat - <<EOF >$V_TUT/src/fortune/server/util/authorizer.go
package util

import (
  "bytes"
  "flag"
  "fortune/ifc"
  "v.io/v23/security"
  "v.io/v23/security/access"
  "v.io/v23/vdl"
)

var (
	perms = flag.String("perms", "",
      "JSON-encoded access.Permissions.")
)

func MakeAuthorizer() (authorizer security.Authorizer) {
  aMap, _ := access.ReadPermissions(
      bytes.NewBufferString(*perms))
  typ := vdl.TypeOf(ifc.Reader)
  authorizer, _ = access.PermissionsAuthorizer(aMap, typ)
  return
}
EOF

go install fortune/server
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'createCarol' (3/4 in completer) of content/tutorials/security/permissions-authorizer.md"
####
$V_BIN/principal create --overwrite $V_TUT/cred/carol carol
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'aliceBlessCarolAsSister' (4/4 in completer) of content/tutorials/security/permissions-authorizer.md"
####
$V_BIN/principal bless \
    --v23.credentials $V_TUT/cred/alice \
    --for=24h $V_TUT/cred/carol family:sister | \
        $V_BIN/principal set \
            --v23.credentials $V_TUT/cred/carol \
            forpeer - alice
#----------------------------------------------------------------------#  End 4

#
# Script @completer from content/tutorials/naming/suffix-part1.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'newDispatcher' (1/2 in completer) of content/tutorials/naming/suffix-part1.md"
####
 cat - <<EOF >$V_TUT/src/fortune/server/util/dispatcher.go
package util

import (
  "errors"
  "strings"
  "sync"
  "fortune/ifc"
  "fortune/service"
  "v.io/v23/context"
  "v.io/v23/rpc"
  "v.io/v23/security"
)

type myDispatcher struct {
  mu sync.Mutex
  registry map[string]interface{}
}

func (d *myDispatcher) Lookup(
    _ *context.T, suffix string) (interface{}, security.Authorizer, error) {
  if strings.Contains(suffix, "/") {
    return nil, nil, errors.New("unsupported service name")
  }
  auth := MakeAuthorizer()
  d.mu.Lock()
  defer d.mu.Unlock()
  if suffix == "" {
    names := make([]string, 0, len(d.registry))
    for name, _ := range d.registry {
      names = append(names, name)
    }
    return rpc.ChildrenGlobberInvoker(names...), auth, nil
  }
  s, ok := d.registry[suffix]
  if !ok {
    // Make the service on first attempt to use.
    s = ifc.FortuneServer(service.Make())
    d.registry[suffix] = s
  }
  return s, auth, nil;
}

func MakeDispatcher() rpc.Dispatcher {
  return &myDispatcher {
    registry: make(map[string]interface{}),
  }
}
EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'buildServer' (2/2 in completer) of content/tutorials/naming/suffix-part1.md"
####
go install fortune/server
#----------------------------------------------------------------------#  End 2

#
# Script @completer from content/tutorials/naming/globber.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'newFileService' (1/5 in completer) of content/tutorials/naming/globber.md"
####
 mkdir -p $V_TUT/src/fileserver
 cat - <<EOF >$V_TUT/src/fileserver/file_service.go
package main

import (
  "errors"
  "v.io/v23/context"
  "v.io/v23/rpc"
)

type fileService struct {
  name string
}

func (s *fileService) GetContents(*context.T, rpc.ServerCall) ([]byte, error) {
  return nil, errors.New("method not implemented")
}

func (s *fileService) SetContents(*context.T, rpc.ServerCall, []byte) (error) {
  return errors.New("method not implemented")
}
EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'newDirService' (2/5 in completer) of content/tutorials/naming/globber.md"
####
 cat - <<EOF >$V_TUT/src/fileserver/dir_service.go
package main

import (
  "os"
  "v.io/v23/context"
  "v.io/v23/glob"
  "v.io/v23/naming"
  "v.io/v23/rpc"
)

type dirService struct {
  name string
}

func (s *dirService) GlobChildren__(
    _ *context.T, call rpc.GlobChildrenServerCall, m *glob.Element) error {
  f, err := os.Open(s.name)
  if err != nil {
    return err
  }
  defer f.Close()
  fi, err := f.Readdir(0)
  if err != nil {
    return err
  }
  sender := call.SendStream()
  for _, file := range fi {
    name := file.Name()
    if m.Match(name) {
      if err := sender.Send(naming.GlobChildrenReplyName{name}); err != nil {
        return err
      }
    }
  }
  return nil
}
EOF
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'newDispatcher' (3/5 in completer) of content/tutorials/naming/globber.md"
####
 cat - <<EOF >$V_TUT/src/fileserver/dispatcher.go
package main

import (
  "os"
  "path/filepath"
  "strings"
  "v.io/v23/context"
  "v.io/v23/security"
)

type myDispatcher struct {
  rootDir string
}

func (d *myDispatcher) Lookup(
    _ *context.T, suffix string) (interface{}, security.Authorizer, error) {

  relPath := filepath.Join(strings.Split(suffix, "/")...)
  path := filepath.Join(d.rootDir, relPath)
  fi, err := os.Stat(path)
  switch {
  case err != nil:
    return nil, nil, err
  case fi.IsDir():
    return &dirService{path}, nil, nil
  default:
    return &fileService{path}, nil, nil
  }
}
EOF
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'newMain' (4/5 in completer) of content/tutorials/naming/globber.md"
####
 cat - <<EOF >$V_TUT/src/fileserver/main.go
package main

import (
  "flag"
  "log"
  "v.io/v23"
  "v.io/x/ref/lib/signals"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  name = flag.String(
    "mount-name", "", "Name for service in default mount table.")
  root = flag.String(
    "root-dir", ".", "The root directory of the file server.")
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

  _, _, err := v23.WithNewDispatchingServer(ctx, *name, &myDispatcher{*root})
  if err != nil {
    log.Panic("Failure creating server: ", err)
  }
  <-signals.ShutdownOnSignals(ctx)
}
EOF
go build fileserver
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'buildServer' (5/5 in completer) of content/tutorials/naming/globber.md"
####
go install fileserver
#----------------------------------------------------------------------#  End 5

echo " "
echo "All done.  No errors."
HANDLED_SCRIPT
