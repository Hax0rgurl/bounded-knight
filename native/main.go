package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "[goof]", err)
		os.Exit(1)
	}
}
func run() error {
	f := newForge(os.Getenv("MAKEFUN_SHOP_TOKEN"), os.Getenv("FORGE_LOGIN"), os.Getenv("MAKEFUN_TRIAL_NOW"))
	origin := strings.TrimRight(os.Getenv("MAKEFUN_ENV_URL"), "/")
	address := ":0"
	standalone := len(os.Args) == 2 && os.Args[1] == "--serve"
	if standalone {
		address = "127.0.0.1:" + defaultString(os.Getenv("PORT"), "0")
	} else if origin == "" {
		return errors.New("MAKEFUN_ENV_URL is not set")
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: f, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 64 << 10}
	if standalone {
		fmt.Printf("http://%s\n", listener.Addr())
		return server.Serve(listener)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()
	defer server.Close()
	client := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{}}
	registration := []byte("{\"port\":" + strconv.Itoa(port) + "}")
	delay := 100 * time.Millisecond
	pause := func() error {
		select {
		case e := <-serveErr:
			return e
		case <-time.After(delay):
			return nil
		}
	}
	for {
		reply, e := client.Post(origin+"/register", "application/json", bytes.NewReader(registration))
		if e == nil {
			code := reply.StatusCode
			io.Copy(io.Discard, reply.Body)
			reply.Body.Close()
			if code == 200 || code == 409 {
				break
			}
			if code == 400 || code == 405 {
				return fmt.Errorf("register returned HTTP %d", code)
			}
		}
		if e := pause(); e != nil {
			return e
		}
		delay = min(2*delay, 2*time.Second)
	}
	fmt.Printf("[goof] registered port %d\n", port)
	delay = 250 * time.Millisecond
	for {
		reply, e := client.Get(origin + "/done")
		if e == nil {
			var state struct{ Done bool }
			e = json.NewDecoder(io.LimitReader(reply.Body, 4096)).Decode(&state)
			reply.Body.Close()
			if e == nil && reply.StatusCode == 200 && state.Done {
				return nil
			}
		}
		if e := pause(); e != nil {
			return e
		}
		delay = min(2*delay, 2*time.Second)
	}
}
